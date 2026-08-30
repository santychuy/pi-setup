---
name: mermaid-diagrams
description: Create, edit, validate, and explain Mermaid diagrams for workflows, architecture, sequence flows, state machines, ER models, timelines, and Gantt charts. Use whenever the user asks for a Mermaid diagram, flowchart, sequence diagram, system diagram, architecture visual, or to fix Mermaid syntax. Mermaid fences render inline natively in Pi.
---

# Mermaid diagrams

Write each diagram as one closed fenced block:

```mermaid
flowchart LR
  A[Input] --> B[Process] --> C[Result]
```

Pi renders closed `mermaid` fences inline natively. Keep the source fence in the response so it remains editable and portable.

## Workflow

1. Choose the smallest diagram type that answers the request: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `classDiagram`, `gantt`, or `journey`.
2. Give every node a stable ASCII identifier and put readable text in its label.
3. Use one diagram for one concept. Split unrelated flows.
4. Emit a complete, closed Mermaid fence. Do not put prose inside the fence.
5. If rendering reports an error, repair the Mermaid source and return a replacement closed fence.

## Reliable patterns

### Workflow

```mermaid
flowchart TD
  Start([Start]) --> Validate{Valid?}
  Validate -->|Yes| Save[Save record]
  Validate -->|No| Reject[Show error]
  Save --> Done([Done])
```

### Sequence

```mermaid
sequenceDiagram
  participant U as User
  participant A as API
  participant D as Database
  U->>A: Submit request
  A->>D: Read data
  D-->>A: Result
  A-->>U: Response
```

### State machine

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Published: publish
  Published --> Archived: archive
  Archived --> [*]
```

## Constraints

- Prefer short labels; quote or bracket labels containing punctuation that Mermaid could parse as syntax.
- Avoid HTML, click handlers, and external links unless explicitly requested.
- Do not claim a diagram is valid unless it rendered successfully.
- For a user-provided diagram, preserve its meaning and make the smallest syntax correction.
