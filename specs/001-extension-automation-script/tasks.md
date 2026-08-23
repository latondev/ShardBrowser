# Tasks: Extension Automation Script for ShardBrowser

**Input**: Design documents from `/specs/001-extension-automation-script/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Optional - not explicitly requested.

**Organization**: Tasks grouped by user story for independent implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- Script root: `Testing/flow/`
- Source: `Testing/flow/src/`
- Tests: `Testing/flow/tests/` (optional)
- Config: `Testing/flow/config.json`
- Logs: `Testing/flow/logs/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create directory structure `Testing/flow/src/`, `Testing/flow/tests/`, `Testing/flow/logs/`
- [x] T002 Initialize npm project in `Testing/flow/` with `package.json`
- [x] T003 [P] Install dependencies: puppeteer, commander, winston, typescript, ts-node, @types/node
- [x] T004 [P] Create `tsconfig.json` in `Testing/flow/` for TypeScript compilation
- [x] T005 [P] Create sample configuration file `Testing/flow/config.sample.json` with fields: url, startIndex, prompt, options (dropdown, checkbox), timeout

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Define TypeScript types/interfaces in `Testing/flow/src/types.ts` (TestConfig, BrowserSession, ExtensionUI, LogEntry)
- [x] T007 Implement configuration loader in `Testing/flow/src/config-loader.ts` to read JSON config with validation
- [x] T008 Implement logger module in `Testing/flow/src/logger.ts` with winston (console + file rotation in `logs/`)
- [x] T009 Implement error handler with custom error classes (TimeoutError, ConnectionError, SelectorNotFoundError) in `Testing/flow/src/error-handler.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Khởi động Profile và kết nối extension (Priority: P1) 🎯 MVP

**Goal**: Launch ShardBrowser profile with extension loaded, connect via CDP

**Independent Test**: Run script with valid extension path; verify browser opens, extension loads, and CDP connection succeeds.

### Implementation for User Story 1

- [x] T010 [US1] Implement BrowserManager class in `Testing/flow/src/browser-manager.ts`:
  - Launch ShardBrowser with `--remote-debugging-port=9222`, `--disable-extensions-except`, `--load-extension`
  - Return browser instance and CDP WebSocket URL
- [x] T011 [US1] Implement connectToBrowser method in `Testing/flow/src/browser-manager.ts` using Puppeteer's `connect` with CDP URL
- [x] T012 [US1] Add error handling for missing extension path or ShardBrowser not found in `Testing/flow/src/browser-manager.ts`
- [x] T013 [US1] Write integration test (optional) in `Testing/flow/tests/browser-manager.test.ts` to verify launch and connection

**Checkpoint**: User Story 1 complete - can launch browser with extension and connect

---

## Phase 4: User Story 2 - Điều hướng và kích hoạt extension (Priority: P2)

**Goal**: Navigate to target URL, open extension UI (popup/side panel)

**Independent Test**: Navigate to configured URL, verify page loads, extension UI becomes accessible.

### Implementation for User Story 2

- [x] T014 [US2] Implement PageNavigator class in `Testing/flow/src/navigator.ts` with `navigateTo(url)` using Puppeteer page.goto()
- [x] T015 [US2] Implement waitForPageLoad with configurable timeout in `Testing/flow/src/navigator.ts`
- [x] T016 [US2] Implement ExtensionUI class in `Testing/flow/src/extension-ui.ts` to detect and open extension popup (via `browserAction` or page.evaluate)
- [x] T017 [US2] Define selectors for extension UI elements (popup, form fields) in `Testing/flow/src/selectors.ts` (to be customized by user)
- [x] T018 [US2] Add error handling for navigation timeout and extension not found in `Testing/flow/src/navigator.ts` and `extension-ui.ts`

**Checkpoint**: User Story 2 complete - can navigate and open extension UI

---

## Phase 5: User Story 3 - Thao tác Form tự động (Priority: P3)

**Goal**: Fill form (startIndex, prompt, dropdown, checkbox) and click Start button

**Independent Test**: Fill form with test data, click Start, verify submission triggers extension flow.

### Implementation for User Story 3

- [x] T019 [US3] Implement FormFiller class in `Testing/flow/src/form-filler.ts` with methods:
  - `fillStartIndex(value)`
  - `fillPrompt(text)`
  - `selectDropdown(option)`
  - `toggleCheckbox(checked)`
- [x] T020 [US3] Implement Executor class in `Testing/flow/src/executor.ts` with `clickStart()` and `waitForExecution()` to monitor flow start
- [x] T021 [US3] Integrate FormFiller and Executor into main script `Testing/flow/src/index.ts` orchestration
- [x] T022 [US3] Add validation for required fields before submission in `Testing/flow/src/form-filler.ts`

**Checkpoint**: User Story 3 complete - can automate form submission

---

## Phase 6: User Story 4 - Theo dõi log và xử lý ngoại lệ (Priority: P4)

**Goal**: Capture console logs from extension, handle timeouts, selector not found, connection loss gracefully

**Independent Test**: Simulate errors (wrong selector, network down) and verify script logs and exits cleanly.

### Implementation for User Story 4

- [x] T023 [US4] Integrate logger to capture browser console messages via `page.on('console')` in `Testing/flow/src/index.ts`
- [x] T024 [US4] Wrap all critical operations with try-catch using error-handler from Phase 2
- [x] T025 [US4] Implement retry logic (max 2 retries) for transient failures (timeout, selector not found) in `Testing/flow/src/error-handler.ts`
- [x] T026 [US4] Ensure script exits with non-zero code on critical failures and writes final summary log

**Checkpoint**: All user stories complete – robust logging and error handling in place

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, documentation, and validation

- [x] T027 Create main entry point `Testing/flow/test-extension-flow.ts` (or .js) that orchestrates all phases and accepts CLI args (--config, --profile)
- [x] T028 [P] Update `Testing/flow/README.md` with setup, configuration, and run instructions
- [x] T029 [P] Create `.gitignore` for `node_modules/`, `logs/`, `dist/` in `Testing/flow/`
- [x] T030 Validate quickstart.md steps by running the script end-to-end with sample config
- [x] T031 [P] Add npm scripts in `package.json`: `build`, `start`, `dev`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies – start immediately
- **Foundational (Phase 2)**: Depends on Setup – BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational
  - US1 (P1) must complete before US2–US4 (US2 needs browser, US3 needs navigation, US4 needs logging)
  - US2 can start after US1; US3 after US2; US4 can be integrated throughout but finalize after US3
- **Polish (Phase 7)**: Depends on all user stories complete

### Parallel Opportunities

- T003, T004, T005 can run in parallel (Phase 1)
- T028, T029, T031 can run in parallel (Phase 7)
- Within US1: T010 and T011 are sequential; T012 error handling can be written alongside
- Different stories are sequential due to dependencies (US1→US2→US3→US4)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1 (launch + connect)
4. **STOP and VALIDATE**: Test that browser launches with extension and CDP connects
5. Deploy/demo if ready (can manually test further steps)

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add US1 → test independently → MVP ready
3. Add US2 → test navigation + extension open
4. Add US3 → test form automation
5. Add US4 → test error handling and logging
6. Polish → finalize documentation and scripts

---

## Notes

- All tasks include file paths; adjust if using JavaScript instead of TypeScript.
- Selectors in `selectors.ts` are placeholders; user must update based on actual extension UI.
- Logs are written to `Testing/flow/logs/` with rotation.
- Configuration is read from JSON; CLI overrides can be added later if needed.
- This plan follows a sequential story pipeline; parallel execution is limited due to dependencies.