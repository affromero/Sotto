# Architecture Diagrams - Sotto

> Visual companion to [01-technical-architecture.md](./01-technical-architecture.md).
> Every diagram below is Mermaid; GitHub and most editors render it inline.
> Kept in sync as each piece lands — see the "sotto terminal client" section for
> the headless `sotto` client.

## 1. System context

How clients reach the system and what the app delegates to.

```mermaid
flowchart TD
    subgraph clients[Clients]
        web["Browser web app"]
        cli["sotto terminal client"]
        agent["Local agents / MCP"]
        device["Connected devices"]
    end

    subgraph app[Next.js app]
        pages["App Router pages (Server Components)"]
        api["/api/v1 routes"]
    end

    subgraph data[Stateful backends]
        pg[("PostgreSQL via Prisma")]
        redis[("Redis - BullMQ queues")]
        store[("Storage - local / S3 / R2")]
    end

    subgraph workers[Worker pool]
        classw["Class generation"]
        audiow["Listening audio"]
        speakw["Speaking grading"]
        refw["Reference validation"]
        keyw["Key validation"]
    end

    subgraph providers[Providers - explicit resolution]
        llm["Learning LLM or local agent"]
        tts["TTS"]
        stt["STT"]
    end

    web --> pages
    web --> api
    cli -->|Bearer sk_sotto_| api
    agent -->|Bearer sk_sotto_| api
    device -->|Bearer sk_sotto_| api

    api --> pg
    api --> redis
    api --> store
    redis --> workers
    workers --> pg
    workers --> store
    classw --> llm
    audiow --> tts
    speakw --> stt
```

API routes stay thin: validate, check ownership, persist a small change or
enqueue a job. Heavy generation, grading, and stitching run in workers.

## 2. Request and auth flow (trust boundary)

`authenticateRequest()` is Bearer-first with a session fallback. In the
single-learner build `auth()` resolves to the local owner without session
verification, so the API trusts the local owner by construction — a remotely
exposed instance must be gated at the proxy/deploy layer.

```mermaid
flowchart TD
    req["Incoming /api/v1 request"] --> hasBearer{"Bearer sk_sotto_ header?"}
    hasBearer -->|yes| validate["validateApiKey: sha256 then ApiKey lookup"]
    validate --> revoked{"found and not revoked?"}
    revoked -->|yes| uid["userId from key"]
    revoked -->|no| reject["401 Unauthorized"]
    hasBearer -->|no| session["auth session fallback"]
    session --> owner{"local owner resolved?"}
    owner -->|yes| uid
    owner -->|no| reject
    uid --> zod["Zod validation"]
    zod --> own["ownership check on userId"]
    own --> admin{"admin route?"}
    admin -->|yes| isadmin["isUserAdmin(userId) - DB role"]
    admin -->|no| work["mutate or enqueue"]
    isadmin --> work
    work --> json["NextResponse.json"]
```

Admin checks key off the authenticated principal (`isUserAdmin(userId)`), not the
ambient session. Session-only `/admin/*` UI routes still use `requireAdmin()`.

### CLI / device pairing to API key

```mermaid
sequenceDiagram
    participant U as User web signed-in
    participant API as pair endpoint
    participant Dev as Device or sotto CLI
    participant Red as redeem endpoint
    U->>API: POST /api/v1/auth/pair
    API-->>U: token, serverUrl, expiresAt
    Note over U,Dev: token shown as QR or copied into sotto login
    Dev->>Red: POST /api/v1/auth/pair/redeem with token
    Red-->>Dev: apiKey sk_sotto_ minted once
    Dev->>Dev: store in ~/.config/sotto
    Dev->>API: later calls send Authorization Bearer sk_sotto_
```

## 3. Monorepo and package dependencies

```mermaid
flowchart LR
    shared["packages/shared - types, Zod, brand, tokens"]
    mcp["packages/mcp"]
    verif["packages/groundcheck"]
    web["apps/web - Next.js, workers, Prisma"]
    desktop["apps/desktop - Tauri shell"]
    tui["tui/ - Rust + ratatui (sotto)"]

    shared --> web
    shared --> mcp
    verif --> web
    web -. HTTP /api/v1 .-> tui
    web --> desktop
```

`tui/` consumes the web app over HTTP only — no shared compile-time dependency.
Contract types are generated from the Zod schemas in `packages/shared` (see §9).

## 4. Core learning data model

Key entities and relationships (provider/ops models omitted).

```mermaid
erDiagram
    User ||--o{ Course : owns
    User ||--o{ ApiKey : has
    User ||--o{ PairingToken : has
    Curriculum ||--o{ Course : templates
    Curriculum ||--o{ Lesson : contains
    Course ||--o{ CourseClass : schedules
    Course ||--o{ PracticeSession : has
    Course ||--o| CourseNote : has
    Course ||--o| PlacementResult : placed_by
    Course ||--o{ LearnerVocab : tracks
    Course ||--o{ LearnerGrammar : tracks
    LearnerVocab ||--o{ VocabEdge : relates
    CourseClass ||--o{ ClassSection : has
    ClassSection ||--o{ LessonQuestion : has
    ClassSection ||--o{ SpeakingPrompt : has
    ClassSection ||--o{ WritingPrompt : has
    CourseClass ||--o| ClassSubmission : graded_by
    SpeakingPrompt ||--o{ SpeakingRecording : answered_by
    PracticeSession ||--o{ SpeakingRecording : answered_by
    MockExam ||--o{ ExamSection : has
    ExamSection ||--o{ ExamQuestion : has
    Episode ||--o{ Segment : stitched_from
    ClassSection ||--o| Episode : listening_audio
    PracticeSession ||--o| Episode : listening_audio
    ExamSection ||--o| Episode : listening_audio
```

`Episode`/`Segment` is the reused audio engine behind every listening surface
(class listening sections, listening practice, exam listening).

## 5. Class generation pipeline

```mermaid
flowchart TD
    seed["course + lesson + CEFR level + memory seed + course note"] --> specs["section specs"]
    specs --> grammar["grammar questions"]
    specs --> reading["reading passage + questions"]
    specs --> listening["listening audio request"]
    specs --> speaking["speaking prompts"]
    specs --> writing["writing prompts"]
    grammar --> avail["CourseClass AVAILABLE"]
    reading --> avail
    listening --> avail
    speaking --> avail
    writing --> avail
```

## 6. Listening audio pipeline (status machine)

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> DISCOVERING
    DISCOVERING --> EXTRACTING
    EXTRACTING --> RESEARCHING
    RESEARCHING --> PLANNING
    PLANNING --> SCRIPTING
    SCRIPTING --> COMPILING
    COMPILING --> SCRIPT_READY
    SCRIPT_READY --> GENERATING_AUDIO
    GENERATING_AUDIO --> STITCHING
    STITCHING --> READY
    READY --> UPDATING
    UPDATING --> SCRIPTING
    READY --> [*]
    DISCOVERING --> FAILED
    SCRIPTING --> FAILED
    COMPILING --> FAILED
    GENERATING_AUDIO --> FAILED
    STITCHING --> FAILED
    FAILED --> [*]
```

Exact values are the `EpisodeStatus` enum in `schema.prisma`. Script
verification and reference validation run within the `SCRIPTING -> COMPILING`
span (the `script-verification` and `reference-validation` workers), not as
their own statuses. `IMPORTING` and `TRANSCRIBING` are alternate entry points
for imported or transcribed source audio; `UPDATING` is regeneration of an
existing episode.

## 7. Speaking grading flow

Speaking uploads are containerized audio bytes only; `detectAudioFormat()` sniffs
the magic bytes so the stored extension, content type, and STT filename/MIME are
honest (browser WebM, `sotto` CLI WAV).

```mermaid
flowchart TD
    up["POST speaking/promptId - multipart audio"] --> sniff["detectAudioFormat(bytes)"]
    sniff --> store["uploadFile to R2 - honest ext and content-type"]
    store --> rec["SpeakingRecording PENDING"]
    rec --> job["enqueue SPEAKING_GRADING"]
    job --> dl["worker downloads bytes"]
    dl --> stt["resolveSttProvider then transcribe - filename/MIME from bytes"]
    stt --> score["pronunciation scoring, rubric, phoneme feedback"]
    score --> done["status SCORED"]
    stt --> fail["status FAILED"]
    poll["client polls GET with recordingId"] -.-> rec
    poll -.-> done
```

## 8. Provider resolution (explicit, no key-sniffing fallback)

```mermaid
flowchart TD
    reqp["learning request"] --> sel["selected provider or local-agent profile"]
    sel --> cap{"capability"}
    cap -->|LLM| rl["resolveLearningAi"]
    cap -->|TTS| rt["resolveTtsProvider"]
    cap -->|STT| rs["resolveSttProvider"]
    rl --> val["validate creds, base URL, model"]
    rt --> val
    rs --> val
    val -->|ok| client["concrete provider client"]
    val -->|missing| err["typed setup error - capability and action"]
```

No worker silently routes to a different provider because another key exists.

## 9. sotto terminal client

Premium Rust + ratatui client (the `sotto` binary). HTTP-only against `/api/v1`;
native audio playback and recording; types generated from the Zod-backed OpenAPI
spec. Lives in `tui/`; see `tui/CLAUDE.md` for the crate-level guide.

```mermaid
flowchart TD
    subgraph sotto[sotto binary - Rust + ratatui]
        login["sotto login - redeem pairing to sk_sotto_"]
        cfg["~/.config/sotto"]
        client["SottoClient - reqwest + generated DTOs"]
        ui["ratatui UI - app / action / event"]
        play["rodio playback"]
        rec["cpal capture to hound WAV"]
    end

    login --> cfg
    cfg --> client
    client -->|Bearer sk_sotto_| apiv1["/api/v1"]
    apiv1 --> client
    client --> ui
    ui --> play
    apiv1 -->|presigned URL| play
    ui --> rec
    rec -->|multipart audio| apiv1

    subgraph contract[Contract sync - CI]
        zod["Zod schemas in packages/shared"] --> jsons["z.toJSONSchema"]
        jsons --> oas["OpenAPI 3.0 (codegen subset)"]
        oas --> gen["progenitor to tui/src generated module"]
        gen -. drift check .-> client
    end
```

### Vocabulary spaced-repetition loop (first vertical slice)

```mermaid
sequenceDiagram
    participant S as sotto
    participant API as api v1
    S->>API: GET courses
    API-->>S: courses
    S->>API: GET courses courseId practice
    API-->>S: due vocab and grammar, totalVocab, recent
    S->>API: POST courses courseId practice, kind VOCAB
    API-->>S: practice session and items
    S->>API: POST practice sessionId submit, answers
    API-->>S: SRS updated, new due counts
```
