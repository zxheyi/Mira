# Project Memory Context

Project Memory preserves the durable and transient context that coding agents need to continue work without turning every observation into an authoritative fact.

## Language

**Project**:
The durable identity and shared scope for one repository across its known roots and worktrees.
_Avoid_: Workspace, folder

**Thread**:
A captured or imported agent session that can provide provenance for proposed Memory.
_Avoid_: Chat, transcript file

**Memory**:
A reviewed or policy-accepted durable project fact with provenance and lifecycle state.
_Avoid_: Note, context

**Working Memory**:
Task-scoped or project-shared transient state used to resume active work.
_Avoid_: Memory, todo file

**Memory Candidate**:
An extracted proposal that may require review before becoming Memory.
_Avoid_: Memory, conclusion

**Recall Receipt**:
An audit record proving which Memory IDs were considered, injected, or omitted from a Context Bundle.
_Avoid_: Usage proof, model decision
