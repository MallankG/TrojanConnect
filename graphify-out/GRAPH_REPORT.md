# Graph Report - USCHack  (2026-11-14)

## Corpus Check
- 203 files · ~511,660 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: (none) 5, .example 1, .ini 1)

## Summary
- 2314 nodes · 6778 edges · 114 communities (97 shown, 17 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 442 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `de6b78fb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- v1/clubs.py
- AgentOrchestrator
- Actor
- AppShell.tsx
- student.py
- LLMResponse
- FakeRepo
- package.json
- AppError
- test_api.py
- SupabaseRepository
- 9.2 Club Agent tools
- FakeRepo
- negotiation.py
- booking/router.py
- InMemoryRepository
- compilerOptions
- TrojanConnect_Final_PRD.md
- build_embedder
- service.py
- 11. UI/UX requirements
- test_booking.py
- 18. Replit implementation plan
- common.tsx
- 6. Agent-to-agent contract
- 16. Observability, evaluation, and testing
- 8. Strict AI guardrails
- Knowledge base: USC student governments and event space
- 10. Gemini model and decision architecture
- 14. Security and privacy
- 1. Problem and opportunity
- TrojanConnect
- re
- 4. Product scope
- 5. Primary user journeys
- 7. Booking state machine and invariants
- Authenticated Seed Data (EngageSC)
- Event planning assistant: integration guide
- parts.tsx
- .claude/CLAUDE.md
- AGENTS.md
- frontend/README.md
- event_pipeline/router.py
- AppError
- event_agent.py
- backfill_embeddings.py
- live.ts
- test_campus.py
- seed.ts
- test_event_agent.py
- v1/slack.py
- SoundEngine
- rules_agent.py
- booking/store.py
- event_plan.py
- booking.ts
- BookingCard.tsx
- inventory.ts
- student.py
- api-client.ts
- Landing.tsx
- fields.ts
- AssistantPanel.tsx
- extras.tsx
- ChaosStage.tsx
- PipelineApp.tsx
- SoundProvider.tsx
- Embedder
- agents.ts
- plan.ts
- test_services.py
- typing
- get_settings
- submit_club_interest
- seeded_busy
- VenueReviewApp.tsx
- policy.py
- test_campus.py
- audit
- Solution.tsx
- FakeQuery
- re
- dependencies
- state-machine.ts
- conftest.py
- test_agents.py
- devDependencies
- 9.3 Venue Scheduling tools
- test_event_agent.py
- LLMResponse
- Already written (do not change signatures)
- gen_seed_sql.py
- .table
- student.tsx
- 9.4 Student Agent tools
- brand/README.md
- scripts
- ToolSpec
- TrojanConnect
- Event Pipeline: running it, inputs, and dry-run test log
- ClubEvent
- adapters.py
- TrojanConnect frontend: handoff context
- TrojanConnect UI styling guide
- README.md
- Event Pipeline
- HashEmbedder

## God Nodes (most connected - your core abstractions)
1. `Actor` - 67 edges
2. `InMemoryRepository` - 59 edges
3. `AppError` - 59 edges
4. `ToolResult` - 49 edges
5. `StrictModel` - 47 edges
6. `ClubProfile` - 44 edges
7. `StudentRepository` - 42 edges
8. `SupabaseRepository` - 41 edges
9. `Settings` - 40 edges
10. `get()` - 40 edges

## Surprising Connections (you probably didn't know these)
- `Integration roadmap (PRD priority order)` --references--> `get_event_plan_status()`  [INFERRED]
  docs/event-pipeline-integration.md → backend/app/tools/event_plan.py
- ``get_booking_status`` --references--> `get_booking_status()`  [INFERRED]
  TrojanConnect_Final_PRD.md → backend/app/tools/event_plan.py
- ``accept_proposal`` --references--> `accept_proposal()`  [INFERRED]
  TrojanConnect_Final_PRD.md → backend/app/workflows/booking/service.py
- `A. Reuse the reference components and restyle them` --references--> `AssistantPanel()`  [INFERRED]
  event-planning-integration.md → frontend/src/components/pipeline/AssistantPanel.tsx
- `Design system (do not drift from this)` --references--> `Rows()`  [INFERRED]
  CONTEXT.md → frontend/src/components/ui/kit.tsx

## Import Cycles
- None detected.

## Communities (114 total, 17 thin omitted)

### Community 0 - "v1/clubs.py"
Cohesion: 0.12
Nodes (12): embedder_dep(), orchestrator_dep(), repo_dep(), club_fit(), ClubInterestBody, save_club(), submit_interest(), require_club() (+4 more)

### Community 1 - "AgentOrchestrator"
Cohesion: 0.24
Nodes (10): AgentOrchestrator, agent_id(), AgentCard, AgentTurn, _submit_script(), test_cancelled_confirmation_writes_nothing(), test_concurrent_confirm_and_cancel_cannot_resolve_the_same_action_twice(), test_confirm_with_share_contact_reports_exactly_what_was_shared() (+2 more)

### Community 2 - "Actor"
Cohesion: 0.12
Nodes (42): acknowledge(), analytics(), AnnouncementBody, ask(), AskBody, club_interests(), club_posts(), create_post() (+34 more)

### Community 3 - "AppShell.tsx"
Cohesion: 0.05
Nodes (49): nextConfig, metadata, PipelinePage(), metadata, Page(), metadata, Page(), metadata (+41 more)

### Community 4 - "student.py"
Cohesion: 0.07
Nodes (28): agent_id(), build_context(), greeting(), club_system_prompt(), data_block(), student_system_prompt(), build_context(), EventTime (+20 more)

### Community 5 - "LLMResponse"
Cohesion: 0.21
Nodes (4): _block(), _norm_tag(), RuleBasedLLM, _words()

### Community 7 - "package.json"
Cohesion: 0.12
Nodes (15): eslintConfig, name, private, version, eslint, eslint-config-next, lenis, motion (+7 more)

### Community 8 - "AppError"
Cohesion: 0.15
Nodes (23): acknowledge(), analytics(), announcements(), ask(), _category(), create_feedback(), inbox(), publish() (+15 more)

### Community 9 - "test_api.py"
Cohesion: 0.13
Nodes (27): err(), ok(), _production(), test_bad_demo_user_id_rejected(), test_client_cannot_pick_roles(), test_club_limit_validation(), test_conversation_flow(), test_conversation_is_private_to_owner() (+19 more)

### Community 10 - "SupabaseRepository"
Cohesion: 0.10
Nodes (3): _now_iso(), SupabaseRepository, build()

### Community 11 - "9.2 Club Agent tools"
Cohesion: 0.14
Nodes (14): 9.1 Shared conventions, 9.2 Club Agent tools, 9.5 USG/GSG tools, 9.6 WhatsApp tools, 9. Tool schemas and contracts, `accept_proposal`, `create_booking_draft`, `create_student_feedback` (+6 more)

### Community 12 - "FakeRepo"
Cohesion: 0.07
Nodes (3): FakeRepo, repo(), fail_once()

### Community 13 - "negotiation.py"
Cohesion: 0.08
Nodes (25): check_venue_availability(), find_venue_options(), find_venue(), _norm(), reviewer_record(), route(), _v(), Venue (+17 more)

### Community 14 - "booking/router.py"
Cohesion: 0.07
Nodes (32): require_client_header(), reviewer_id(), accept(), alternatives(), _call(), cancel(), confirm(), create_draft() (+24 more)

### Community 15 - "InMemoryRepository"
Cohesion: 0.04
Nodes (31): StudentRepository, InMemoryRepository, _cols(), AuditLog, ClubInterest, ClubProfile, Conversation, Message (+23 more)

### Community 16 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 17 - "TrojanConnect_Final_PRD.md"
Cohesion: 0.11
Nodes (18): 12. API surface, 15. WhatsApp integration, 17. Technology stack, 19. Hackathon demo narrative, 20. Delivery priorities, 21. Open assumptions to validate, 22. Definition of done, 2.1 MVP goals (+10 more)

### Community 18 - "build_embedder"
Cohesion: 0.15
Nodes (10): build_embedder(), OllamaEmbedder, FakeAsyncClient, FakeResponse, test_embedding_provider_rejects_unknown_values(), test_ollama_embedder_rejects_wrong_vector_dimensions(), post(), test_ollama_embedder_uses_model_and_normalizes_vectors() (+2 more)

### Community 19 - "service.py"
Cohesion: 0.12
Nodes (42): run(), _agent(), _attention(), _authorize(), _auto_review(), auto_review_enabled(), BookingError, build_payload() (+34 more)

### Community 20 - "11. UI/UX requirements"
Cohesion: 0.20
Nodes (10): 11.1 Existing repository constraint, 11.2 Design direction, 11.3 Shared application shell, 11.4 Student UI, 11.5 Club representative UI, 11.6 Venue reviewer UI, 11.7 USG/GSG UI, 11.8 Shared chat UI (+2 more)

### Community 21 - "test_booking.py"
Cohesion: 0.10
Nodes (41): accept_proposal(), cancel(), confirm(), current_event_id(), decide(), _idempotent(), list_for_event(), prepare() (+33 more)

### Community 22 - "18. Replit implementation plan"
Cohesion: 0.22
Nodes (9): 18. Replit implementation plan, Step 1: Inspect before modifying, Step 2: Establish shared contracts, Step 3: Build data foundation, Step 4: Build booking workflow before broad agents, Step 5: Add agents, Step 6: Build UI, Step 7: WhatsApp (+1 more)

### Community 23 - "common.tsx"
Cohesion: 0.17
Nodes (45): Section(), BookingDetail(), BookingLine(), BookingsList(), CLOSED, ClubDashboard(), ClubProfile(), ClubTabs() (+37 more)

### Community 24 - "6. Agent-to-agent contract"
Cohesion: 0.25
Nodes (8): 6.1 Agent identities, 6.2 Message envelope, 6.3 Allowed message types, 6.4 Booking request payload, 6.5 Offer/counteroffer payload, 6.6 Negotiation termination, 6. Agent-to-agent contract, Envelope requirements

### Community 25 - "16. Observability, evaluation, and testing"
Cohesion: 0.29
Nodes (7): 16. Observability, evaluation, and testing, Evaluation set, Integration tests, Observability, Required tests, Security tests, Unit tests

### Community 26 - "8. Strict AI guardrails"
Cohesion: 0.29
Nodes (7): 8.1 Global rules for every agent, 8.2 Booking-specific guardrails, 8.3 Student and recommendation guardrails, 8.4 USG/GSG guardrails, 8.5 WhatsApp guardrails, 8.6 Human escalation triggers, 8. Strict AI guardrails

### Community 27 - "Knowledge base: USC student governments and event space"
Cohesion: 0.40
Nodes (4): Caveats for the agent, Knowledge base: USC student governments and event space, Source domains (all official USC), What's in it

### Community 28 - "10. Gemini model and decision architecture"
Cohesion: 0.40
Nodes (5): 10.1 Recommended model responsibilities, 10.2 Gemini Decisions API, 10.3 Embeddings and recommendation, 10.4 Agent framework, 10. Gemini model and decision architecture

### Community 29 - "14. Security and privacy"
Cohesion: 0.40
Nodes (5): 14. Security and privacy, Audit, Authentication, Authorization, Secrets

### Community 30 - "1. Problem and opportunity"
Cohesion: 0.40
Nodes (5): 1.1 Event administration, 1.2 Club discovery, 1.3 Student-government awareness, 1.4 Alumni connection, 1. Problem and opportunity

### Community 31 - "TrojanConnect"
Cohesion: 0.50
Nodes (4): 0. Executive decision, Final Product Requirements & Technical Specification, Product principle, TrojanConnect

### Community 32 - "re"
Cohesion: 0.10
Nodes (22): build_steps(), coerce_field(), derive_state(), digits(), email_draft(), _f(), field_applies(), field_problem() (+14 more)

### Community 33 - "4. Product scope"
Cohesion: 0.50
Nodes (4): 4. Product scope, P0: Core MVP, P1: Secondary, P2: Future

### Community 34 - "5. Primary user journeys"
Cohesion: 0.50
Nodes (4): 5.1 Club booking journey, 5.2 Student discovery journey, 5.3 USG/GSG journey, 5. Primary user journeys

### Community 35 - "7. Booking state machine and invariants"
Cohesion: 0.50
Nodes (4): 7.1 States, 7.2 State transition authority, 7.3 Non-negotiable invariants, 7. Booking state machine and invariants

### Community 37 - "Event planning assistant: integration guide"
Cohesion: 0.15
Nodes (14): 10. Current limits, 11. Where the code is, 1. How it works, 4. The chat contract, 5. Cards (`actions`), 7. Embedding and custom styling, 8. Rules any UI must keep, 9. Other endpoints (+6 more)

### Community 38 - "parts.tsx"
Cohesion: 0.10
Nodes (43): ACTOR_LABEL, BookingRow(), BookingStepper(), CHECK_LABEL, PROPOSAL_STATUS, ProposalCard(), RequestSummary(), StatusCard() (+35 more)

### Community 43 - "event_pipeline/router.py"
Cohesion: 0.08
Nodes (19): agent_chat(), agent_info(), ChatMessage, ChatRequest, get_activity(), get_caterers(), get_email(), get_form() (+11 more)

### Community 44 - "AppError"
Cohesion: 0.18
Nodes (11): AppError, gov_scope(), _require_club(), _audit(), _club(), create_post(), interest_inbox(), notifications() (+3 more)

### Community 48 - "event_agent.py"
Cohesion: 0.14
Nodes (5): _clean_history(), run_turn(), _system_prompt(), ChatSession, ModelProvider

### Community 51 - "backfill_embeddings.py"
Cohesion: 0.24
Nodes (5): _embed_batch(), _fetch_embedding_rows(), main(), test_embed_batch_refuses_fallback_vectors(), test_fetch_embedding_rows_reads_every_page()

### Community 52 - "live.ts"
Cohesion: 0.06
Nodes (37): AgentCard, AgentTurn, Announcement, AskResult, cache, campus, ClubEvent, ClubInterestItem (+29 more)

### Community 53 - "test_campus.py"
Cohesion: 0.09
Nodes (12): create_app(), _app_error(), _http_error(), _unhandled(), _validation_error(), _fail(), ctx(), send() (+4 more)

### Community 54 - "seed.ts"
Cohesion: 0.12
Nodes (27): me(), call(), subscribe(), useGet(), CLUBS, DB_VERSION, EMPTY_DB, event() (+19 more)

### Community 55 - "test_event_agent.py"
Cohesion: 0.12
Nodes (13): ModelError, ModelTurn, ToolCall, configured(), GeminiProvider, model_id(), _Session, FailingProvider (+5 more)

### Community 56 - "v1/slack.py"
Cohesion: 0.09
Nodes (20): _actor(), _agent_reply(), _club_line(), events(), _handle(), _preview_post(), _publish(), slash_command() (+12 more)

### Community 58 - "rules_agent.py"
Cohesion: 0.18
Nodes (24): _ask_fields(), _brief_reply(), _caterer_in(), _choose_room(), _date(), _fmt_day(), _food_pick(), _food_quote() (+16 more)

### Community 59 - "booking/store.py"
Cohesion: 0.20
Nodes (12): cancel_event(), backend(), _configured(), _hash(), load(), path(), _probe(), reset_backend_cache() (+4 more)

### Community 60 - "event_plan.py"
Cohesion: 0.20
Nodes (24): _booking_action(), booking_brief(), check_caterer(), draft_email(), fail(), _form_action(), get_booking_status(), get_event_plan_status() (+16 more)

### Community 61 - "booking.ts"
Cohesion: 0.33
Nodes (30): acceptProposal(), ACTOR_KIND, differencesFor(), emptyDraft(), escalate(), fail(), findBooking(), findConversation() (+22 more)

### Community 62 - "BookingCard.tsx"
Cohesion: 0.24
Nodes (12): BookingCard(), fmtDay(), fmtStamp(), fmtTime(), ProposalBox(), Props, SENDER, Stages() (+4 more)

### Community 63 - "inventory.ts"
Cohesion: 0.07
Nodes (42): Day, extract(), Extraction, FEATURES, findDay(), findTimes(), HUMAN_CHECK, MONTHS (+34 more)

### Community 64 - "student.py"
Cohesion: 0.13
Nodes (11): ClubSearchHit, FitCheckResult, PendingConfirmation, Recommendation, build_service_modules(), fit_check(), get_preferences(), recommend_clubs() (+3 more)

### Community 65 - "api-client.ts"
Cohesion: 0.12
Nodes (13): 3. Conventions for every request, Message, AgentAction, AgentMessageView, AgentReply, ApiError, AuditEntry, BookingState (+5 more)

### Community 66 - "Landing.tsx"
Cohesion: 0.28
Nodes (11): Home(), Principle(), Start(), Header(), HeaderTheme, TONE, Landing(), subscribe() (+3 more)

### Community 67 - "fields.ts"
Cohesion: 0.11
Nodes (19): FORM_IDS, USED, Field(), GROUPS, USED_BY, AUDIENCES, CATERER_TYPES, EQUIPMENT (+11 more)

### Community 68 - "AssistantPanel.tsx"
Cohesion: 0.21
Nodes (18): ActionCard(), CardProps, Props, STARTERS, DraftButton(), FormCard(), Props, SectionTitle() (+10 more)

### Community 69 - "extras.tsx"
Cohesion: 0.07
Nodes (36): Demo(), metadata, metadata, Page(), metadata, Page(), metadata, Page() (+28 more)

### Community 70 - "ChaosStage.tsx"
Cohesion: 0.16
Nodes (18): ChaosPinned(), ChaosStage(), ChaosStatic(), Props, TurnContent(), GHOST_WORDS, PEOPLE, Person (+10 more)

### Community 71 - "PipelineApp.tsx"
Cohesion: 0.26
Nodes (14): AssistantPanel(), FieldMatrix(), PipelineApp(), Tab, TABS, ProfileForm(), StepDetail(), DOT (+6 more)

### Community 72 - "SoundProvider.tsx"
Cohesion: 0.14
Nodes (15): bricolage, caslon, metadata, RootLayout(), viewport, Cue, CueOptions, listeners (+7 more)

### Community 73 - "Embedder"
Cohesion: 0.12
Nodes (11): ResilientEmbedder, Embedder, Backend map (`backend/app/`), Commands, Conventions, graphify, Layout, Non-negotiable rules (PRD 7.3, 8) (+3 more)

### Community 74 - "agents.ts"
Cohesion: 0.21
Nodes (21): askClub(), askGovernment(), askStudentAgent(), CATEGORIES, fail(), now(), ok(), openConversation() (+13 more)

### Community 75 - "plan.ts"
Cohesion: 0.17
Nodes (14): buildSteps(), COMMON_CONTACT, COMMON_EVENT, daysBetween(), DerivedStep, deriveState(), FormDef, FormMode (+6 more)

### Community 76 - "test_services.py"
Cohesion: 0.08
Nodes (43): greeting(), StudentPreferencesUpdate, club_similarities(), club_text(), matched_tags(), _prefilter(), search_clubs(), _space() (+35 more)

### Community 77 - "typing"
Cohesion: 0.29
Nodes (5): build_seed_event(), _load_json(), load_seed_events(), load_seed_students(), _read_seed()

### Community 78 - "get_settings"
Cohesion: 0.23
Nodes (10): get_settings(), _build_embedder(), _build_llm(), _build_orchestrator(), _build_repository(), get_embedder(), get_llm(), get_orchestrator() (+2 more)

### Community 79 - "submit_club_interest"
Cohesion: 0.29
Nodes (10): ClubInterestCreate, _interest_audit_log(), shared_fields(), submit_club_interest(), _interest(), test_interest_is_idempotent_and_audited(), test_interest_requires_confirmation(), test_interest_retry_repairs_a_failed_audit_write() (+2 more)

### Community 81 - "VenueReviewApp.tsx"
Cohesion: 0.18
Nodes (14): metadata, VenueReviewPage(), btn, btnPrimary, MARKER, Tone, fmt(), OPEN (+6 more)

### Community 82 - "policy.py"
Cohesion: 0.22
Nodes (7): _fmt(), Issue, issues_as_dicts(), request_issues(), reviewer_notes(), window_issues(), _warnings()

### Community 83 - "test_campus.py"
Cohesion: 0.26
Nodes (9): as_(), client(), test_announcements_need_the_right_government_scope(), test_basic_overview_questions_get_answers(), test_club_agent_answers_what_the_club_does(), test_feedback_needs_consent_and_scoped_inbox(), test_government_answers_cite_sources_or_refuse(), test_only_the_clubs_rep_can_post_and_followers_are_notified() (+1 more)

### Community 84 - "audit"
Cohesion: 0.27
Nodes (4): audit(), transition(), TransitionError, test_state_machine_refuses_model_and_wrong_roles()

### Community 85 - "Solution.tsx"
Cohesion: 0.22
Nodes (14): SCRIPT, ScriptMessage, stepFor(), STEPS, cueFor(), Fill(), Message(), Row() (+6 more)

### Community 87 - "re"
Cohesion: 0.30
Nodes (10): build(), derive_tags(), directory_profile(), main(), slugify(), snake(), clean_text(), load_existing() (+2 more)

### Community 88 - "dependencies"
Cohesion: 0.20
Nodes (10): dependencies, gsap, @gsap/react, lenis, lucide-react, motion, next, radix-ui (+2 more)

### Community 89 - "state-machine.ts"
Cohesion: 0.23
Nodes (9): Architecture, Actor, BookingState, assertTransition(), canTransition(), PHASES, Tone, TransitionError (+1 more)

### Community 90 - "conftest.py"
Cohesion: 0.32
Nodes (3): api_app(), api_client(), api_settings()

### Community 91 - "test_agents.py"
Cohesion: 0.12
Nodes (25): check_input(), check_output(), InputCheck, _leaks_prompt(), refusal_message(), ConversationCreate, _club_chat(), test_club_agent_admits_missing_information() (+17 more)

### Community 92 - "devDependencies"
Cohesion: 0.22
Nodes (9): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/turbopack, @types/node, @types/react, @types/react-dom (+1 more)

### Community 93 - "9.3 Venue Scheduling tools"
Cohesion: 0.25
Nodes (8): 9.3 Venue Scheduling tools, `confirm_booking`, `create_proposal`, `record_human_decision`, `route_booking_request`, `search_venue_inventory`, `submit_for_human_review`, `validate_proposal`

### Community 94 - "test_event_agent.py"
Cohesion: 0.11
Nodes (25): execute(), apply(), _apply_confirmed_slot(), apply(), step(), apply(), add_log(), load() (+17 more)

### Community 95 - "LLMResponse"
Cohesion: 0.48
Nodes (4): LLMResponse, ScriptedLLM, test_output_guardrail_blocks_leak_from_a_misbehaving_model(), test_tool_loop_is_bounded()

### Community 96 - "Already written (do not change signatures)"
Cohesion: 0.25
Nodes (7): health(), Already written (do not change signatures), Environment, Interfaces between owners, Ownership, Rules (PRD 8.1, 8.3), Student Agent backend contract

### Community 97 - "gen_seed_sql.py"
Cohesion: 0.29
Nodes (5): load_seed_clubs(), resolve_dataset(), lit(), main(), upsert()

### Community 99 - "student.tsx"
Cohesion: 0.19
Nodes (23): useOpenChat(), ClubPage(), ClubRow(), Discover(), EventList(), EventRow(), Events(), LiveError() (+15 more)

### Community 100 - "9.4 Student Agent tools"
Cohesion: 0.33
Nodes (6): 9.4 Student Agent tools, `get_student_preferences`, `recommend_clubs`, `search_clubs`, `start_club_conversation`, `submit_club_interest`

### Community 103 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, start

### Community 104 - "ToolSpec"
Cohesion: 0.20
Nodes (7): build_llm(), GeminiLLM, ResilientLLM, ChatMessage, LLMClient, ToolCall, ToolSpec

### Community 105 - "TrojanConnect"
Cohesion: 0.15
Nodes (12): 2. Run it, Configuration (`backend/.env`), Docs, Features by role, How the agents work, How these numbers were measured, Not built, Run it (+4 more)

### Community 106 - "Event Pipeline: running it, inputs, and dry-run test log"
Cohesion: 0.17
Nodes (12): 1. How to run it, 2. Inputs required, 3. Safety: how we test without submitting, 4. Results, Appendix: dry-run harness, Backend API (local only, no USC contact): ✅ pass, Dashboard UI (`/pipeline`): ✅ pass (one bug fixed), ECE (EEB/PHE) availability (read-only public calendars): ✅ pass (two bugs fixed) (+4 more)

### Community 108 - "ClubEvent"
Cohesion: 0.16
Nodes (4): ClubEvent, FAQItem, make_clubs(), test_naive_event_datetimes_get_campus_timezone()

### Community 109 - "adapters.py"
Cohesion: 0.22
Nodes (4): AdapterError, get_adapter(), register(), VenueBookingAdapter

### Community 110 - "TrojanConnect frontend: handoff context"
Cohesion: 0.20
Nodes (10): Design system (do not drift from this), History worth knowing, Not verified, or known gaps, Open questions for the team, Routes, Run it, Stack and rules that will bite you, TrojanConnect frontend: handoff context (+2 more)

### Community 113 - "TrojanConnect UI styling guide"
Cohesion: 0.22
Nodes (9): Color, Existing feature and source map, Interaction, accessibility, and rendering, Landing page and motion, Layout and responsive behavior, New-feature checklist, Product and design direction, TrojanConnect UI styling guide (+1 more)

### Community 114 - "README.md"
Cohesion: 0.16
Nodes (7): Decision for the team, Event Pipeline: fit with the TrojanConnect PRD and integration plan, Gaps against the PRD foundations, Integration roadmap (PRD priority order), Summary, Where it conflicts with the PRD (fix first), Where it fits

### Community 115 - "Event Pipeline"
Cohesion: 0.25
Nodes (8): API, Event Pipeline, How each step is handled, Known gaps, Rules the venue agent enforces (`booking/policy.py`), Setup, The booking workflow, Where things live

### Community 117 - "HashEmbedder"
Cohesion: 0.18
Nodes (5): GeminiEmbedder, HashEmbedder, _l2(), orch(), repo()

## Knowledge Gaps
- **8 isolated node(s):** `motion`, `react-dom`, `@tailwindcss/turbopack`, `@types/node`, `@types/react` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 750 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `13. Database model` connect `Actor` to `Event planning assistant: integration guide`, `AppError`, `booking/router.py`, `TrojanConnect_Final_PRD.md`, `v1/slack.py`, `booking/store.py`?**
  _High betweenness centrality (0.395) - this node is a cross-community bridge._
- **Are the 44 inferred relationships involving `Actor` (e.g. with `AgentOrchestrator` and `build_context()`) actually correct?**
  _`Actor` has 44 INFERRED edges - model-reasoned connections that need verification._
- **What connects `motion`, `react-dom`, `@tailwindcss/turbopack` to the rest of the system?**
  _8 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `v1/clubs.py` be split into smaller, more focused modules?**
  _Cohesion score 0.11693548387096774 - nodes in this community are weakly interconnected._
- **Why does `message()` connect `Event planning assistant: integration guide` to `Actor`, `live.ts`, `seed.ts`?**
  _High betweenness centrality (0.347) - this node is a cross-community bridge._
- **Are the 13 inferred relationships involving `InMemoryRepository` (e.g. with `AuditLog` and `ClubEvent`) actually correct?**
  _`InMemoryRepository` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Should `Actor` be split into smaller, more focused modules?**
  _Cohesion score 0.11530398322851153 - nodes in this community are weakly interconnected._