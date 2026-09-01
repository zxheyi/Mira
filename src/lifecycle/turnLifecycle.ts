import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prepareContext, type ContextPacket } from "../context/contextPreparation.js";
import { appendDomainEvent, enqueueOutboxMessage } from "../events/domainOutboxStore.js";
import { captureSession } from "../threads/sessionCapture.js";
import { INVOCATION_TRANSPORTS, MIRA_HOSTS, type AfterTurnCommand, type BeforeTurnCommand, type InvocationTransport, type MiraHost, type TurnOutcomeStatus } from "./hostAdapterRegistry.js";

export type LifecycleSession = {
  id: string; projectId: string; host: MiraHost; hostSessionId: string;
  status: "open" | "closed"; openedAt: string; lastSeenAt: string; closedAt?: string;
};
export type LifecycleTurn = {
  id: string; projectId: string; sessionId: string; hostTurnId: string; taskId?: string;
  query: string; response?: string; outcomeStatus?: TurnOutcomeStatus; status: "started" | "completed";
  recallEventId?: string; startedAt: string; completedAt?: string;
};
export type CaptureRecord = {
  id: string; projectId: string; turnId: string; threadId?: string; contentHash: string;
  outcome: "imported" | "updated" | "unchanged"; capturedAt: string;
};
export type BeforeTurnResult = {session: LifecycleSession; turn: LifecycleTurn; context: ContextPacket};
export type AfterTurnResult = {session: LifecycleSession; turn: LifecycleTurn; capture: CaptureRecord; eventId: string; outboxMessageIds: string[]; duplicate: boolean};
export type TurnLifecyclePort = {beforeTurn(command: BeforeTurnCommand): BeforeTurnResult; afterTurn(command: AfterTurnCommand): AfterTurnResult};

type SessionRow = {id:string;project_id:string;host:MiraHost;host_session_id:string;status:"open"|"closed";opened_at:string;last_seen_at:string;closed_at:string|null};
type TurnRow = {id:string;project_id:string;session_id:string;host_turn_id:string;task_id:string|null;query:string;response:string|null;outcome_status:TurnOutcomeStatus|null;status:"started"|"completed";recall_event_id:string|null;started_at:string;completed_at:string|null;before_input_hash:string|null;before_result:string|null;after_input_hash:string|null;after_result:string|null};
type CaptureRow = {id:string;project_id:string;turn_id:string;thread_id:string|null;content_hash:string;outcome:"imported"|"updated"|"unchanged";captured_at:string};

const beforeSchema = z.object({
  host: z.enum(MIRA_HOSTS), transport:z.enum(INVOCATION_TRANSPORTS).optional(),hostSessionId: z.string().trim().min(1).max(500),
  hostTurnId: z.string().trim().min(1).max(500), query: z.string().trim().min(1).max(50_000),
  taskId: z.string().trim().min(1).max(500).optional(),
  context: z.object({memoryLimit:z.number().int().min(1).max(50).optional(),maxCharacters:z.number().int().min(1).max(1_000_000).optional(),maxTokens:z.number().int().min(25).max(250_000).optional()}).strict().optional()
}).strict();
const afterSchema = z.object({
  host: z.enum(MIRA_HOSTS), transport:z.enum(INVOCATION_TRANSPORTS).optional(),hostSessionId: z.string().trim().min(1).max(500),
  hostTurnId: z.string().trim().min(1).max(500), query: z.string().trim().min(1).max(50_000),
  response: z.string().trim().min(1).max(50_000), outcomeStatus: z.enum(["succeeded","failed","cancelled"]),
  taskId: z.string().trim().min(1).max(500).optional(),
  transcript: z.object({
    threadId:z.string().trim().min(1).max(500),title:z.string().trim().min(1).max(500),
    rawFormat:z.enum(["markdown","jsonl"]),rawText:z.string().trim().min(1).max(5_000_000),
    checkpoint:z.object({agent:z.enum(["codex","claude-code"]),sessionId:z.string().trim().min(1).max(500),
      transcriptPath:z.string().trim().min(1).max(4000),size:z.number().int().min(0),mtimeMs:z.number().finite().min(0)}).strict().optional()
  }).strict().optional()
}).strict();

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const threadIdFor = (projectId: string, host: MiraHost, hostSessionId: string) =>
  `thread_lifecycle_${createHash("sha256").update(`${projectId}\0${host}\0${hostSessionId}`).digest("hex").slice(0, 24)}`;
const toSession = (row: SessionRow): LifecycleSession => ({id:row.id,projectId:row.project_id,host:row.host,hostSessionId:row.host_session_id,status:row.status,openedAt:row.opened_at,lastSeenAt:row.last_seen_at,...(row.closed_at?{closedAt:row.closed_at}:{})});
const toTurn = (row: TurnRow): LifecycleTurn => ({id:row.id,projectId:row.project_id,sessionId:row.session_id,hostTurnId:row.host_turn_id,...(row.task_id?{taskId:row.task_id}:{}),query:row.query,...(row.response?{response:row.response}:{}),...(row.outcome_status?{outcomeStatus:row.outcome_status}:{}),status:row.status,...(row.recall_event_id?{recallEventId:row.recall_event_id}:{}),startedAt:row.started_at,...(row.completed_at?{completedAt:row.completed_at}:{})});
const toCapture = (row: CaptureRow): CaptureRecord => ({id:row.id,projectId:row.project_id,turnId:row.turn_id,...(row.thread_id?{threadId:row.thread_id}:{}),contentHash:row.content_hash,outcome:row.outcome,capturedAt:row.captured_at});
const transportFor = (host:MiraHost, transport?:InvocationTransport): InvocationTransport =>
  transport ?? (host === "codex" || host === "claude-code" || host === "cursor" ? "native" : host);

function requireProject(db: Database.Database, projectId: string): void {
  if (!db.prepare("select 1 from projects where id = ?").get(projectId)) throw new Error(`Project not found: ${projectId}`);
}

function findSession(db: Database.Database, projectId: string, host: MiraHost, hostSessionId: string): SessionRow | undefined {
  return db.prepare("select * from lifecycle_sessions where project_id = ? and host = ? and host_session_id = ?")
    .get(projectId, host, hostSessionId) as SessionRow | undefined;
}

function ensureSession(db: Database.Database, projectId: string, host: MiraHost, hostSessionId: string, now: string): SessionRow {
  const existing = findSession(db, projectId, host, hostSessionId);
  if (existing) return existing;
  const id = `lifecycle_session_${randomUUID()}`;
  db.prepare("insert into lifecycle_sessions (id, project_id, host, host_session_id, status, opened_at, last_seen_at) values (?, ?, ?, ?, 'open', ?, ?)")
    .run(id, projectId, host, hostSessionId, now, now);
  return findSession(db, projectId, host, hostSessionId)!;
}

function findTurn(db: Database.Database, projectId: string, sessionId: string, hostTurnId: string): TurnRow | undefined {
  return db.prepare("select * from lifecycle_turns where project_id = ? and session_id = ? and host_turn_id = ?")
    .get(projectId, sessionId, hostTurnId) as TurnRow | undefined;
}

function findCapture(db: Database.Database, projectId: string, turnId: string): CaptureRow | undefined {
  return db.prepare("select * from capture_records where project_id = ? and turn_id = ?")
    .get(projectId, turnId) as CaptureRow | undefined;
}

function sessionTranscript(db: Database.Database, projectId: string, session: SessionRow): string {
  const turns = db.prepare("select * from lifecycle_turns where project_id = ? and session_id = ? and status = 'completed' order by started_at, rowid")
    .all(projectId, session.id) as TurnRow[];
  return turns.map(turn => [
    `## Turn ${turn.host_turn_id}`,
    `- host: ${session.host}`,
    `- status: ${turn.outcome_status}`,
    "### User", turn.query,
    "### Assistant", turn.response ?? ""
  ].join("\n")).join("\n\n");
}

export function createTurnLifecycle(options: {db: Database.Database; projectId: string}): TurnLifecyclePort {
  const {db, projectId} = options;
  requireProject(db, projectId);
  return {
    beforeTurn(command) {
      const input = beforeSchema.parse(command);
      const inputHash = hash(input);
      return db.transaction((): BeforeTurnResult => {
        const now = new Date().toISOString();
        const session = ensureSession(db, projectId, input.host, input.hostSessionId, now);
        const existing = findTurn(db, projectId, session.id, input.hostTurnId);
        if (existing) {
          if (existing.before_input_hash !== inputHash) throw new Error("Before Turn input conflicts with the existing Turn");
          if (!existing.before_result) throw new Error("Before Turn is incomplete and must be retried after recovery");
          return JSON.parse(existing.before_result) as BeforeTurnResult;
        }
        const turnId = `lifecycle_turn_${randomUUID()}`;
        db.prepare(`insert into lifecycle_turns (
          id, project_id, session_id, host_turn_id, task_id, query, status, before_input_hash, started_at
        ) values (?, ?, ?, ?, ?, ?, 'started', ?, ?)`)
          .run(turnId, projectId, session.id, input.hostTurnId, input.taskId ?? null, input.query, inputHash, now);
        const context = prepareContext(db, projectId, {taskId:input.taskId, query:input.query, ...input.context});
        db.prepare("update lifecycle_turns set recall_event_id = ? where project_id = ? and id = ?")
          .run(context.receipt.id, projectId, turnId);
        const event = appendDomainEvent(db, {projectId, aggregateType:"turn", aggregateId:turnId,
          eventType:"turn_started", payload:{sourceHost:input.host,transport:transportFor(input.host,input.transport),sessionId:session.id,recallEventId:context.receipt.id}});
        void event;
        const updatedTurn = findTurn(db, projectId, session.id, input.hostTurnId)!;
        const result: BeforeTurnResult = {session:toSession(session),turn:toTurn(updatedTurn),context};
        db.prepare("update lifecycle_turns set before_result = ? where project_id = ? and id = ?")
          .run(JSON.stringify(result), projectId, turnId);
        return result;
      })();
    },
    afterTurn(command) {
      const input = afterSchema.parse(command);
      const inputHash = hash(input);
      return db.transaction((): AfterTurnResult => {
        const now = new Date().toISOString();
        let session = ensureSession(db, projectId, input.host, input.hostSessionId, now);
        let turn = findTurn(db, projectId, session.id, input.hostTurnId);
        if (!turn) {
          const turnId = `lifecycle_turn_${randomUUID()}`;
          db.prepare(`insert into lifecycle_turns (
            id, project_id, session_id, host_turn_id, task_id, query, status, started_at
          ) values (?, ?, ?, ?, ?, ?, 'started', ?)`)
            .run(turnId, projectId, session.id, input.hostTurnId, input.taskId ?? null, input.query, now);
          appendDomainEvent(db, {projectId, aggregateType:"turn", aggregateId:turnId,
            eventType:"turn_started", payload:{sourceHost:input.host,transport:transportFor(input.host,input.transport),sessionId:session.id,captureOnly:true}, createdAt:now});
          turn = findTurn(db, projectId, session.id, input.hostTurnId)!;
        }
        if (turn.query !== input.query || (turn.task_id ?? undefined) !== input.taskId) {
          throw new Error("After Turn input conflicts with the existing Turn");
        }
        if (turn.status === "completed") {
          if (turn.after_input_hash !== inputHash) throw new Error("After Turn input conflicts with the completed Turn");
          const stored = JSON.parse(turn.after_result!) as AfterTurnResult;
          const existingCapture = findCapture(db, projectId, turn.id);
          if (!existingCapture) throw new Error("Completed Turn is missing its Capture Record");
          if (existingCapture.thread_id) return {...stored, duplicate:true};
          const transcript = input.transcript ?? {
            threadId:threadIdFor(projectId, input.host, input.hostSessionId),
            title:`${input.host} lifecycle ${input.hostSessionId}`,
            rawFormat:"markdown" as const,
            rawText:sessionTranscript(db, projectId, session)
          };
          const repaired = captureSession(db, {id:transcript.threadId,projectId,title:transcript.title,
            source:input.host,rawFormat:transcript.rawFormat,rawText:transcript.rawText,
            ...(transcript.checkpoint ? {checkpoint:transcript.checkpoint} : {})});
          db.prepare("update capture_records set thread_id = ?, outcome = ? where project_id = ? and id = ?")
            .run(repaired.thread.id, repaired.outcome, projectId, existingCapture.id);
          const repairedCapture = toCapture(findCapture(db, projectId, turn.id)!);
          const event = appendDomainEvent(db, {projectId,aggregateType:"capture",aggregateId:existingCapture.id,
            eventType:"capture_repaired",payload:{turnId:turn.id,threadId:repaired.thread.id},createdAt:now});
          const outbox = [
            enqueueOutboxMessage(db, {projectId,eventId:event.id,topic:"capture.distill.requested",payload:{captureRecordId:existingCapture.id,threadId:repaired.thread.id},createdAt:now}),
            enqueueOutboxMessage(db, {projectId,eventId:event.id,topic:"projection.refresh.requested",payload:{reason:"capture_repaired",turnId:turn.id},createdAt:now})
          ];
          const result: AfterTurnResult = {...stored,capture:repairedCapture,eventId:event.id,
            outboxMessageIds:outbox.map(item=>item.id),duplicate:false};
          db.prepare("update lifecycle_turns set after_result = ? where project_id = ? and id = ?")
            .run(JSON.stringify(result), projectId, turn.id);
          return result;
        }
        db.prepare(`update lifecycle_turns set response = ?, outcome_status = ?, status = 'completed',
          after_input_hash = ?, completed_at = ? where project_id = ? and id = ? and status = 'started'`)
          .run(input.response, input.outcomeStatus, inputHash, now, projectId, turn.id);
        db.prepare("update lifecycle_sessions set last_seen_at = ? where project_id = ? and id = ?")
          .run(now, projectId, session.id);
        session = findSession(db, projectId, input.host, input.hostSessionId)!;
        turn = findTurn(db, projectId, session.id, input.hostTurnId)!;
        const transcript = input.transcript ?? {
          threadId:threadIdFor(projectId, input.host, input.hostSessionId),
          title:`${input.host} lifecycle ${input.hostSessionId}`,
          rawFormat:"markdown" as const,
          rawText:sessionTranscript(db, projectId, session)
        };
        const captured = captureSession(db, {id:transcript.threadId,projectId,title:transcript.title,
          source:input.host,rawFormat:transcript.rawFormat,rawText:transcript.rawText,
          ...(transcript.checkpoint ? {checkpoint:transcript.checkpoint} : {})});
        const capture: CaptureRecord = {id:`capture_${randomUUID()}`,projectId,turnId:turn.id,threadId:captured.thread.id,
          contentHash:hash({query:input.query,response:input.response,status:input.outcomeStatus,thread:captured.thread.rawText}),
          outcome:captured.outcome,capturedAt:now};
        db.prepare("insert into capture_records (id, project_id, turn_id, thread_id, content_hash, outcome, captured_at) values (?, ?, ?, ?, ?, ?, ?)")
          .run(capture.id, capture.projectId, capture.turnId, capture.threadId, capture.contentHash, capture.outcome, capture.capturedAt);
        const threadId = captured.thread.id;
        const event = appendDomainEvent(db, {projectId,aggregateType:"turn",aggregateId:turn.id,
          eventType:"turn_completed",payload:{sourceHost:input.host,transport:transportFor(input.host,input.transport),sessionId:session.id,captureRecordId:capture.id,threadId,outcomeStatus:input.outcomeStatus},createdAt:now});
        const outbox = [
          enqueueOutboxMessage(db, {projectId,eventId:event.id,topic:"capture.distill.requested",payload:{captureRecordId:capture.id,threadId},createdAt:now}),
          enqueueOutboxMessage(db, {projectId,eventId:event.id,topic:"projection.refresh.requested",payload:{reason:"turn_completed",turnId:turn.id},createdAt:now})
        ];
        const result: AfterTurnResult = {session:toSession(session),turn:toTurn(turn),capture,eventId:event.id,outboxMessageIds:outbox.map(item=>item.id),duplicate:false};
        db.prepare("update lifecycle_turns set after_result = ? where project_id = ? and id = ?")
          .run(JSON.stringify(result), projectId, turn.id);
        return result;
      })();
    }
  };
}
