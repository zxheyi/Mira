import type Database from "better-sqlite3";

export type TranscriptSpan = {start:number; end:number; role:"user"|"assistant"; sourceTurnRef:string};

/** Build text and role boundaries together from persisted lifecycle fields. */
export function buildSessionTranscript(db:Database.Database, projectId:string, sessionId:string, host:string) {
  const turns=db.prepare("select host_turn_id, query, response, outcome_status from lifecycle_turns where project_id = ? and session_id = ? and status = 'completed' order by started_at, rowid")
    .all(projectId,sessionId) as Array<{host_turn_id:string;query:string;response:string|null;outcome_status:string|null}>;
  let text="";
  const spans:TranscriptSpan[]=[];
  for(const turn of turns) {
    if(text) text+="\n\n";
    text+=`## Turn ${turn.host_turn_id}\n- host: ${host}\n- status: ${turn.outcome_status}\n### User\n`;
    spans.push({start:text.length,end:text.length+turn.query.length,role:"user",sourceTurnRef:turn.host_turn_id});
    text+=turn.query+"\n### Assistant\n";
    const response=turn.response??"";
    spans.push({start:text.length,end:text.length+response.length,role:"assistant",sourceTurnRef:turn.host_turn_id});
    text+=response;
  }
  return {text,spans};
}

export function storedTranscriptSpans(db:Database.Database, projectId:string, threadId:string, raw:string):TranscriptSpan[] {
  const sessions=db.prepare(`select distinct s.id, s.host from capture_records c
    join lifecycle_turns t on t.id=c.turn_id and t.project_id=c.project_id
    join lifecycle_sessions s on s.id=t.session_id and s.project_id=t.project_id
    where c.project_id=? and c.thread_id=?`).all(projectId,threadId) as Array<{id:string;host:string}>;
  for(const session of sessions) {
    const transcript=buildSessionTranscript(db,projectId,session.id,session.host);
    if(transcript.text===raw) return transcript.spans;
  }
  return [];
}
