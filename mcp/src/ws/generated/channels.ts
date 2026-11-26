/**
 * Generated file - do not edit.
 * Source: contracts/loadcraft-asyncapi.json. Regenerate with "npm run gen:ws" (from mcp/).
 */

// ---- analysis: /ws/gatling-analysis/{run_id}

/** Analysis entered a stage: collect (10; 45 when reading the project's telemetry source), analyze (55), persist (90). */
export type GatlingAnalysisProgress = {
  payload: {
    current_step: "collect" | "analyze" | "persist";
    progress: 10 | 45 | 55 | 90;
    status: "in_progress";
    /** Human-readable stage; the telemetry collect label names the source. */
    step_label: string;
  };
  type: "gatling-analysis:progress";
};
export type GatlingAnalysisProgressBody = GatlingAnalysisProgress["payload"];

/** Analysis document persisted; carries the document. */
export type GatlingAnalysisComplete = {
  payload: {
    /** Stored analysis document, as GET .../executions/{execution_id}/analysis returns it. */
    analysis: {
      confidence: "high" | "medium" | "low";
      /** Root-cause hypothesis per error group. */
      error_analyses: ({
        confidence?: "high" | "medium" | "low";
        error_hash?: string;
        /** Verbatim quotes from the run's material. */
        evidence?: string[];
        /** Status of the error group; null when it has none. */
        http_status?: number | null;
        probable_cause?: string;
        suggested_fixes?: string[];
      })[];
      /** Telemetry bundle from the project's evidence source; only when one is configured. */
      external_evidence?: Record<string, unknown>;
      /** Findings/citations removed as unsupported, per reason. Absent when no analyzer model is configured. */
      grounding_dropped?: Record<string, number>;
      /** Endpoints that slowed together; null exactly when latency_steps is. */
      latency_step_pattern: Record<string, unknown>[] | null;
      /** Measured latency step changes; null when not measured. */
      latency_steps: Record<string, unknown>[] | null;
      /** Why latency_steps is null; null when it is set. */
      latency_steps_reason: string | null;
      performance_concerns: ({
        after_ms?: number | null;
        before_ms?: number | null;
        endpoint?: string;
        /** latency_step, p99_response_time, error_rate, throughput or mean_response_time. */
        metric?: string;
        /** ms for times, fraction for rates. */
        observed?: number;
        severity?: "critical" | "high" | "medium" | "low";
        summary?: string;
        /** T+m:ss; latency_step only. */
        window_end_offset?: string | null;
        /** T+m:ss; latency_step only. */
        window_start_offset?: string | null;
      })[];
      recommendations: string[];
      step_hypotheses: ({
        checks?: string[];
        endpoints?: string[];
        hypothesis?: string;
        kind?: "isolated" | "shared";
      })[];
      /** Headline, max 900 chars. */
      summary: string;
      verdict: "pass" | "partial" | "fail";
    };
    run_id: string;
    status: "completed";
  };
  type: "gatling-analysis:complete";
};
export type GatlingAnalysisCompleteBody = GatlingAnalysisComplete["payload"];

/** Analysis failed; nothing persisted. */
export type GatlingAnalysisError = {
  payload: {
    /** User-facing failure message. */
    error: string;
    /** Running the analysis again may succeed (false e.g. when the run's metrics series expired). */
    recoverable: boolean;
  };
  type: "gatling-analysis:error";
};
export type GatlingAnalysisErrorBody = GatlingAnalysisError["payload"];

/** Progress and result of an AI analysis of one execution. Nothing is sent on connect and nothing is replayed: frames go only to sockets connected when emitted (the run waits up to 2 s for a first socket). The server never closes the socket. No credentials are presented. */
export type AnalysisServerFrame = GatlingAnalysisProgress | GatlingAnalysisComplete | GatlingAnalysisError;

export type AnalysisClientFrame = never;

// ---- batch: /ws/batch-generation/{run_id}

/** A journey's generation step advanced; also replayed on connect as that journey's last event. */
export type BatchBasketProgress = {
  payload: {
    /** Journey id from the request. */
    basket_id: string;
    /** Percent of this journey. */
    progress: number;
    status: "generating";
    /** Pipeline node name, e.g. analyze_schemas, validate_flow, build_blocks. */
    step: string;
    /** Human-readable step; falls back to step. */
    step_label: string;
  };
  type: "batch-generation:basket-progress";
};
export type BatchBasketProgressBody = BatchBasketProgress["payload"];

/** A journey's flow was generated and saved. */
export type BatchBasketComplete = {
  payload: {
    basket_id: string;
    /** How many needs_input items are proved to fail (their steps answered 401); 0 when none. The flow is still saved and status stays complete. */
    definite_count: number;
    /** Saved flow. */
    flow_id: string;
    flow_name: string;
    /** Gaps the generated flow asks the user about; null when none. */
    needs_input: (({
      /** What the gap is about, e.g. a plan step name. */
      field?: string;
      kind?: "poll_status" | "websocket_frames" | "auth" | "step_outside_approved_endpoints" | "asyncapi_channel_parameter" | "obstacle" | "credential_scheme" | "static_credential";
      question?: string;
      why?: string;
    })[]) | null;
    status: "complete";
  };
  type: "batch-generation:basket-complete";
};
export type BatchBasketCompleteBody = BatchBasketComplete["payload"];

/** A journey's generation failed; the run continues. */
export type BatchBasketError = {
  payload: {
    basket_id: string;
    /** User-facing failure. */
    error: string;
    /** Generating this journey again may succeed. */
    retryable: boolean;
    status: "failed";
  };
  type: "batch-generation:basket-error";
};
export type BatchBasketErrorBody = BatchBasketError["payload"];

/** Every journey ended; last frame of the run (replayed on connect after the end). No journey event follows. */
export type BatchComplete = {
  payload: {
    failed_count: number;
    status: "complete";
    success_count: number;
  };
  type: "batch-generation:complete";
};
export type BatchCompleteBody = BatchComplete["payload"];

/** The run itself failed (last frame, other journeys stopped), or the run is unknown (reason run_not_found, then close 4404). */
export type BatchError = {
  payload: {
    /** User-facing failure. */
    error: string;
    /** Absent for an unknown run. */
    failed_count?: number;
    /** Present only for an unknown run. */
    reason?: "run_not_found";
    /** Running the batch again may succeed. Absent for an unknown run. */
    recoverable?: boolean;
    status: "failed";
    /** Absent for an unknown run. */
    success_count?: number;
  };
  type: "batch-generation:error";
};
export type BatchErrorBody = BatchError["payload"];

/** Progress of a batch generation started by POST /api/v1/projects/{project_id}/flow-suggestions/batch-generate: per-journey events, then the run's end. On connect the server replays the last event of every journey that reported (request order), then the end frame if the run has ended; the socket stays open. No credentials are presented. */
export type BatchServerFrame = BatchBasketProgress | BatchBasketComplete | BatchBasketError | BatchComplete | BatchError;

export type BatchClientFrame = never;

// ---- describe: /ws/projects/{project_id}/scenario-from-description/runs/{run_id}

/** Run-wide or per-path progress of the pipeline. */
export type DescribeProgress = {
  /** Event details; keys depend on node. Per-path events always carry path_index. */
  details: ({
    attempt?: number;
    /** Text the progress card shows. */
    description?: string;
    /** Saved flow id (persist_flow completed). */
    flow_id?: string | null;
    max_attempts?: number;
    /** Step cap. */
    max_steps?: number;
    path_count?: number;
    path_index?: number;
    path_name?: string;
    /** Integer 1 or 3 on run-wide events; string `setup`, `driving` or `building` on per-path events. */
    phase?: unknown;
    /** Agent step. */
    step?: number;
    /** Whether the last agent action succeeded. */
    success?: boolean | null;
  }) | null;
  /** Pipeline step. */
  node: "browser_agent" | "setup" | "build_flow" | "persist_flow";
  /** Percent, 0-100. */
  progress: number;
  status: "running" | "completed";
  type: "progress";
};
export type DescribeProgressBody = Omit<DescribeProgress, "type">;

/** A path's flow was built (no flow_id) and again when it is saved (with flow_id). */
export type DescribePathDone = {
  /** Saved flow id; only on the post-save event. */
  flow_id?: string;
  path_index: number;
  path_name: string;
  type: "path_done";
};
export type DescribePathDoneBody = Omit<DescribePathDone, "type">;

/** An attempt of a path failed, or a path was never driven. */
export type DescribePathFailed = {
  /** Failed attempt; absent when not_driven. */
  attempt?: number;
  /** Path was never driven; present only as true. */
  not_driven?: boolean;
  path_index: number;
  path_name: string;
  /** Failure text. */
  reason: string;
  type: "path_failed";
  /** Another attempt follows. */
  will_retry: boolean;
};
export type DescribePathFailedBody = Omit<DescribePathFailed, "type">;

/** A path's flow build reached a stage (once per stage per attempt). */
export type DescribePathStage = {
  attempt: number;
  path_index: number;
  stage: "reading" | "building" | "naming";
  type: "path_stage";
};
export type DescribePathStageBody = Omit<DescribePathStage, "type">;

/** The description splits into 2+ journeys; the run waits for split_resume. Replayed on connect while parked. */
export type DescribeSplitProposal = {
  proposed_paths: {
    /** Signs up its own account; skips the shared sign-in. */
    creates_own_identity: boolean;
    /** Needs state a previous journey created. */
    depends_on_prior: boolean;
    /** Changes server state. */
    mutates: boolean;
    /** Journey name. */
    name: string;
    /** Result is produced asynchronously and read back afterwards. */
    needs_verify: boolean;
    /** Why it is its own journey. */
    rationale: string;
    /** Ordered plain-language steps. */
    steps: string[];
    /** UI may suggest adding a wait step. */
    suggest_wait_hint?: boolean;
  }[];
  /** One shared sign-in runs before the journeys. */
  shared_sign_in: boolean;
  type: "split_proposal";
};
export type DescribeSplitProposalBody = Omit<DescribeSplitProposal, "type">;

/** An approval was refused because every agent browser is busy; the split still waits. */
export type DescribeSplitResumeRefused = {
  /** Every agent browser of the instance is open. */
  detail: {
    error: "agent_browsers_busy";
    /** Agent browsers allowed on the instance. */
    limit: number;
    /** Sentence to show. */
    message: string;
  };
  type: "split_resume_refused";
};
export type DescribeSplitResumeRefusedBody = Omit<DescribeSplitResumeRefused, "type">;

/** First frame for a client connecting mid-drive: where each path stands. Sent to that socket only. */
export type DescribeDriveSnapshot = {
  paths: ({
    name: string;
    /** Failed without being driven; present only as true. */
    not_driven?: boolean;
    path_index: number;
    /** Failure text (failed), or the earlier attempt's failure (stopped, optional). */
    reason?: string;
    state: "done" | "stopped" | "failed" | "driving" | "queued";
    /** Stop code; only when stopped. */
    stop_cause?: string | null;
  })[];
  /** Shared setup state. */
  setup: "running" | "done";
  type: "drive_snapshot";
};
export type DescribeDriveSnapshotBody = Omit<DescribeDriveSnapshot, "type">;

/** Terminal: the run completed (or needs_input). Replayed on connect for a finished run. */
export type DescribeComplete = {
  /** Live: the run summary. Replay after restart: the GET run details body. A key described "Live only" or "Replay only" comes from that producer alone. */
  result: {
    /** Replay only. */
    all_paths_failed?: boolean;
    /** Replay only. */
    approved_paths_names?: string[];
    /** Replay only. */
    awaiting_split_approval?: boolean;
    /** Live only. Blocks of the first built flow. Present when the run built one. */
    block_count?: number;
    /** Live only. 1 when the run built a test flow, else 0. */
    candidate_count?: number;
    /** Replay only. */
    created_at?: string | null;
    /** Replay only. */
    current_step?: string | null;
    /** Live only. Optional enrichments that timed out or failed; omitted when none. */
    degradations?: Record<string, unknown>[];
    /** Replay only. The description the run was started with. */
    description?: string | null;
    /** Live only. Draft candidates are ready for review. */
    draft_ready?: boolean;
    /** Live only. Edges of the first built flow. Present when the run built one. */
    edge_count?: number;
    /** Replay only. */
    error_message?: string | null;
    /** Replay only. */
    error_technical?: string | null;
    /** Live only. Same as session_duration_ms. */
    execution_time_ms?: number;
    /** Live only. The flows that could not be saved; omitted when none. */
    failed_flows?: {
      name: string;
      path_index: number;
      reason: string;
    }[];
    /** Approved paths the drive could not complete. Live: omitted when none. Replay: always present, without the journeys that have a saved flow. */
    failed_paths?: ({
      /** Live, for a classified failure. */
      hint?: string | null;
      name: string;
      /** Live: present (true) only for a path that was never driven. Replay: always present. */
      not_driven?: boolean;
      /** The approved-path index. */
      path_index: number;
      reason: string;
      /** Live, for a classified failure. */
      technical?: string | null;
    })[];
    /** Live only. Where the agent ended. */
    final_url?: string | null;
    /** Live only. Number of test_flows. Present with test_flows. */
    flow_count?: number;
    /** Live only. The first saved flow; null when none was saved. Present when the run built a test flow. */
    flow_id?: string | null;
    /** Live only. The ids of the saved flows. Present with test_flows. */
    flow_ids?: string[];
    /** Live only. Present when the run built a test flow. */
    flow_name?: string | null;
    /** Live only. The approved-path index of each entry of test_flows. Present with test_flows. */
    flow_path_indices?: number[];
    /** Replay only. */
    flows_saved?: ({
      change_reason: string | null;
      flow_id: string | null;
      name: string;
      note: string | null;
      path_index: number | null;
      version: number | null;
    })[];
    /** Live only. */
    has_test_flow?: boolean;
    /** Replay only. */
    last_heartbeat_at?: string | null;
    /** Live only. What the first built flow still needs from the user; omitted when nothing. */
    needs_input?: unknown;
    /** Live only. The agent stopped early (for example at its step limit). */
    partial?: boolean;
    /** Live only. */
    partial_reason?: string | null;
    /** Replay only. Every path of the run, in approval order. */
    paths?: ({
      attempts: number[];
      failure_reason: string | null;
      flow_change_reason: string | null;
      flow_id: string | null;
      flow_version: number | null;
      name: string;
      not_driven: boolean;
      partial: boolean;
      path_index: number;
      producer_redriven: string | null;
      status: "queued" | "driving" | "built" | "saved" | "failed" | "stopped";
      step_count: number;
      stop_cause: string | null;
    })[];
    /** Live only. Whether a flow was saved. */
    persisted?: boolean;
    /** Live only. The flows saved; omitted when none. */
    persisted_flows?: {
      flow_id: string;
      name: string;
      /** What the drive of the path did not carry out; omitted when it carried out everything. */
      note?: string;
      path_index: number;
    }[];
    /** Live only. */
    phase?: "complete";
    /** Live only. The first (up to six) blocks of the first built flow. Present when the run built one. */
    preview_blocks?: {
      name: string;
      type: string;
    }[];
    /** Always 2. */
    protocol_version: number;
    /** Live only. The descriptions of the last (up to three) agent actions. */
    recent_actions?: string[];
    /** Replay only. The attempt a re-drive in progress drives; null when none. */
    redrive?: ({
      attempt: number;
      from_step: number | null;
      path_index: number;
      started_at: string | null;
    }) | null;
    /** Live only. Same as total_requests. */
    request_count?: number;
    /** Replay only. */
    run_ended_at?: string | null;
    run_id: string;
    /** Live only. Duration of the agent session. */
    session_duration_ms?: number;
    /** `completed` live; on replay the row status (`completed` or `needs_input`). */
    status: string;
    /** Live only. Actions the agent took. */
    steps_executed?: number;
    /** Live only. Approved paths whose drive was stopped; omitted when none. */
    stopped_paths?: ({
      name: string;
      note: string | null;
      path_index: number;
      reason: string;
    })[];
    /** Replay only. */
    target_host?: string | null;
    /** Replay only. */
    target_url?: string | null;
    /** Live only. The first built flow. Present when the run built one. */
    test_flow?: Record<string, unknown>;
    /** Live only. Every built flow, one per driven path; omitted when none. */
    test_flows?: Record<string, unknown>[];
    /** Replay only. The start of the description, on one line. */
    title?: string;
    /** Live only. At most one entry: the built test flow. */
    top_candidates?: {
      /** Always null. */
      confidence: unknown;
      is_shared_setup: boolean;
      name: string;
      segment_id: string;
    }[];
    /** Live only. Requests the agent recorded. */
    total_requests?: number;
  };
  type: "complete";
};
export type DescribeCompleteBody = Omit<DescribeComplete, "type">;

/** Terminal: the run failed; or a split_resume arrived with no pending approval (non-terminal). */
export type DescribeError = {
  /** User-facing cause. */
  error: string;
  /** Failing step, e.g. split_plan, split_approval, browser_agent, segment_har. */
  node: string | null;
  /** Raw technical detail. */
  technical: string | null;
  type: "error";
};
export type DescribeErrorBody = Omit<DescribeError, "type">;

/** Terminal: the run was cancelled. */
export type DescribeCancelled = {
  type: "cancelled";
};
export type DescribeCancelledBody = Omit<DescribeCancelled, "type">;

/** Terminal: the run was abandoned by the backend (restart, lost task). */
export type DescribeInterrupted = {
  /** Explanation. */
  error: string;
  type: "interrupted";
};
export type DescribeInterruptedBody = Omit<DescribeInterrupted, "type">;

/** One finished step of the agent or the sign-in driver. */
export type DescribeAgentStep = {
  /** One timeline step. */
  step: {
    /** Attempt of the path; null for a shared sign-in step. */
    attempt: number | null;
    /** Plan step indexes an operator part covered. */
    covered_plan_steps: number[];
    ended_at: string | null;
    /** Failure text; only when outcome is failed. */
    failure: string | null;
    failure_code: ("navigation_refused" | "credential_step" | "element_not_found" | "page_timed_out" | "action_failed" | "page_unchanged" | "error_page" | "no_answer") | null;
    /** Step id (hex). */
    id: string;
    /** What was done, plain text. */
    label: string;
    outcome: "ok" | "failed" | "skipped";
    /** Path of the page acted on, identifiers replaced. */
    page_path: string | null;
    path_index: number;
    /** Index of the plan step served, from 0. */
    plan_step_index: number | null;
    /** Why, plain text. */
    reason: string | null;
    reason_kind: ("plan_step" | "clearing_the_way" | "signing_in" | "operator") | null;
    /** Sign-in number (from 1) for a sign-in step; else null. */
    sign_in: number | null;
    source: "agent" | "replay" | "operator" | "login";
    started_at: string | null;
    /** Agent step within the attempt, from 1; null for a sign-in step. */
    step_number: number | null;
    /** Id of the step screenshot (GET .../still). */
    still_id: string | null;
    /** Why there is no screenshot. */
    still_missing: ("blocked_address" | "no_image") | null;
    /** Element acted on, plain text. */
    target: string | null;
  };
  type: "agent_step";
};
export type DescribeAgentStepBody = Omit<DescribeAgentStep, "type">;

/** The plan of one attempt of a path, before its first step. */
export type DescribeAgentPlan = {
  plan: {
    attempt: number;
    path_index: number;
    steps: string[];
  };
  type: "agent_plan";
};
export type DescribeAgentPlanBody = Omit<DescribeAgentPlan, "type">;

/** Reply to `hint`: the hint was accepted for the path. */
export type DescribeHintAccepted = {
  attempt: number | null;
  hint_id: string;
  path_index: number;
  /** Agent step at which it was read. */
  step: number | null;
  /** Hint text; null on read receipts. */
  text: string | null;
  type: "hint_accepted";
};
export type DescribeHintAcceptedBody = Omit<DescribeHintAccepted, "type">;

/** Reply to `hint`: refused. */
export type DescribeHintRefused = {
  code: "hint_invalid_message" | "hint_too_long" | "hint_account_placeholder" | "hint_too_often" | "hint_path_not_current" | "hint_nothing_running" | "hint_stopping" | "hint_control_taken";
  /** Seconds to wait; only with hint_too_often. */
  retry_after_s?: number;
  type: "hint_refused";
};
export type DescribeHintRefusedBody = Omit<DescribeHintRefused, "type">;

/** The agent received a hint. */
export type DescribeHintRead = {
  attempt: number | null;
  hint_id: string;
  path_index: number;
  /** Agent step at which it was read. */
  step: number | null;
  /** Hint text; null on read receipts. */
  text: string | null;
  type: "hint_read";
};
export type DescribeHintReadBody = Omit<DescribeHintRead, "type">;

/** A hint the path ended before reading. */
export type DescribeHintNotRead = {
  attempt: number | null;
  hint_id: string;
  path_index: number;
  /** Agent step at which it was read. */
  step: number | null;
  /** Hint text; null on read receipts. */
  text: string | null;
  type: "hint_not_read";
};
export type DescribeHintNotReadBody = Omit<DescribeHintNotRead, "type">;

/** A Stop was accepted (by `stop` or a timed wait); the run is stopping. */
export type DescribeStopAccepted = {
  /** Re-drive's attempt; null for the run's own Stop. */
  attempt: number | null;
  /** Re-drive's path; null for the run's own Stop. */
  path_index: number | null;
  /** Stop code. */
  reason: "stopped_by_user" | "replay_wait_expired" | "help_wait_expired";
  type: "stop_accepted";
};
export type DescribeStopAcceptedBody = Omit<DescribeStopAccepted, "type">;

/** Reply to `stop`: refused. */
export type DescribeStopRefused = {
  code: "stop_nothing_running" | "stop_already_stopping" | "stop_control_taken";
  type: "stop_refused";
};
export type DescribeStopRefusedBody = Omit<DescribeStopRefused, "type">;

/** A re-drive of one path of the finished run started; on connect, sent instead of the terminal frame while it runs. */
export type DescribeRedriveStarted = {
  attempt: number;
  /** Step the replay runs to; null: the agent drives all. */
  from_step: number | null;
  path_index: number;
  started_at: string | null;
  type: "redrive_started";
};
export type DescribeRedriveStartedBody = Omit<DescribeRedriveStarted, "type">;

/** The replay stopped before a step; waits for `replay_continue` or `stop` until expires_at. */
export type DescribeRedriveDiverged = {
  attempt: number;
  divergence: "element_not_found" | "url_mismatch";
  element_name: string | null;
  element_role: string | null;
  expires_at: string | null;
  path_index: number;
  step_number: number;
  type: "redrive_diverged";
};
export type DescribeRedriveDivergedBody = Omit<DescribeRedriveDiverged, "type">;

/** Reply to `replay_continue`: the agent decides from the diverged step. */
export type DescribeRedriveContinued = {
  attempt: number;
  path_index: number;
  step_number: number;
  type: "redrive_continued";
};
export type DescribeRedriveContinuedBody = Omit<DescribeRedriveContinued, "type">;

/** The replay reached a part the user did by hand: journey continues at once; obstacle waits for Take control or Stop until expires_at. */
export type DescribeRedriveOperatorPart = {
  attempt: number;
  expires_at: string | null;
  kind: "journey" | "obstacle";
  obstacle_kind: ("captcha" | "one_time_code" | "payment" | "other") | null;
  path_index: number;
  step_number: number;
  type: "redrive_operator_part";
};
export type DescribeRedriveOperatorPartBody = Omit<DescribeRedriveOperatorPart, "type">;

/** The re-drive was cancelled; the flow keeps its previous version. */
export type DescribeRedriveCancelled = {
  attempt: number;
  path_index: number;
  type: "redrive_cancelled";
};
export type DescribeRedriveCancelledBody = Omit<DescribeRedriveCancelled, "type">;

/** How a re-drive ended. */
export type DescribeRedriveResult = {
  attempt: number;
  /** Why it failed (failed). */
  failure: string | null;
  /** Saved flow (saved). */
  flow_id: string | null;
  /** Saved version (saved). */
  flow_version: number | null;
  /** What the drive did not carry out. */
  note: string | null;
  outcome: "saved" | "failed" | "stopped" | "refused";
  /** Saved drive stopped short. */
  partial: boolean;
  path_index: number;
  /** Driving again can help (failed). */
  recoverable: boolean;
  /** Every agent browser of the instance is open. */
  refusal: {
    error: "agent_browsers_busy";
    /** Agent browsers allowed on the instance. */
    limit: number;
    /** Sentence to show. */
    message: string;
  } | null;
  /** Stop code. */
  stop_cause: string | null;
  type: "redrive_result";
};
export type DescribeRedriveResultBody = Omit<DescribeRedriveResult, "type">;

/** Reply to `replay_continue`: nothing waits, or the message is malformed. */
export type DescribeReplayContinueRefused = {
  code: "replay_continue_invalid_message" | "replay_continue_nothing_waiting";
  type: "replay_continue_refused";
};
export type DescribeReplayContinueRefusedBody = Omit<DescribeReplayContinueRefused, "type">;

/** The agent asks the user to take control (liveView) or Stop, until expires_at. */
export type DescribeHelpRequested = {
  /** Agent's own sentence, max 200 chars. */
  agent_says: string | null;
  attempt: number;
  expires_at: string | null;
  path_index: number;
  reason: "captcha" | "second_factor" | "unknown_blocker";
  type: "help_requested";
};
export type DescribeHelpRequestedBody = Omit<DescribeHelpRequested, "type">;

/** The user now steers the path's browser. */
export type DescribeControlTaken = {
  attempt: number;
  path_index: number;
  started_at: string | null;
  type: "control_taken";
};
export type DescribeControlTakenBody = Omit<DescribeControlTaken, "type">;

/** The browser went back to the agent. */
export type DescribeControlReturned = {
  attempt: number;
  /** What the user's part was; null when the drive ended. */
  choice: ("journey" | "obstacle") | null;
  obstacle_kind: ("captcha" | "one_time_code" | "payment" | "other") | null;
  path_index: number;
  reason: "handed_back" | "inactivity" | "drive_ended";
  type: "control_returned";
};
export type DescribeControlReturnedBody = Omit<DescribeControlReturned, "type">;

/** A client message was not handled. */
export type DescribeMessageDenied = {
  /** Socket closes after project_access_denied (4003) and run_not_found (4404). */
  code: "editor_role_required" | "project_access_denied" | "run_not_found" | "unknown_message_type" | "malformed_message";
  /** `type` of the refused message; null if absent or not a string. */
  message_type: string | null;
  type: "message_denied";
};
export type DescribeMessageDeniedBody = Omit<DescribeMessageDenied, "type">;

/** Stop the run (or its running re-drive). Control message: needs editor role and run ownership, re-checked per message. */
export type DescribeStop = {
  type: "stop";
};
export type DescribeStopBody = Omit<DescribeStop, "type">;

/** Send the agent a hint for the path it drives. Control message: needs editor role and run ownership, re-checked per message. */
export type DescribeHint = {
  path_index: number;
  /** Max 500 chars; no account placeholders. */
  text: string;
  type: "hint";
};
export type DescribeHintBody = Omit<DescribeHint, "type">;

/** Cancel the run (or its running re-drive). Control message: needs editor role and run ownership, re-checked per message. */
export type DescribeCancel = {
  type: "cancel";
};
export type DescribeCancelBody = Omit<DescribeCancel, "type">;

/** Let the agent decide from the step a replay diverged at. Control message: needs editor role and run ownership, re-checked per message. */
export type DescribeReplayContinue = {
  path_index: number;
  type: "replay_continue";
};
export type DescribeReplayContinueBody = Omit<DescribeReplayContinue, "type">;

/** Approve the split proposal with the (edited) journeys. Control message: needs editor role and run ownership, re-checked per message. */
export type DescribeSplitResume = {
  /** Approved journeys in drive order; read as [] when absent. */
  paths?: {
    creates_own_identity?: boolean;
    depends_on_prior?: boolean;
    mutates?: boolean;
    /** Journey name. */
    name?: string;
    /** Name was generated, not typed by the user. */
    name_generated?: boolean;
    needs_verify?: boolean;
    rationale?: string;
    /** Ordered plain-language steps the agent drives. */
    steps?: string[];
  }[];
  type: "split_resume";
};
export type DescribeSplitResumeBody = Omit<DescribeSplitResume, "type">;

/** Streams one scenario-from-description run: progress, split approval, timeline, re-drives and its terminal outcome; accepts run controls. After accept the first frame replays state: redrive_started (finished run being re-driven), else the terminal frame (complete/error/cancelled/interrupted), else split_proposal (parked on approval), else drive_snapshot (drive under way), else nothing. The socket stays open after terminal frames. Before accept: Origin must equal the Host (same scheme default port); principal must be a project member with at least viewer role (an API token pinned to another project is refused); the run must be the principal's own. A refused handshake closes before accept (the server answers HTTP 403; browsers report 1006). Credentials: API token or signed session token in Authorization: Bearer, session cookie, or a signed session token in ?token= (never an API token). */
export type DescribeServerFrame = DescribeProgress | DescribePathDone | DescribePathFailed | DescribePathStage | DescribeSplitProposal | DescribeSplitResumeRefused | DescribeDriveSnapshot | DescribeComplete | DescribeError | DescribeCancelled | DescribeInterrupted | DescribeAgentStep | DescribeAgentPlan | DescribeHintAccepted | DescribeHintRefused | DescribeHintRead | DescribeHintNotRead | DescribeStopAccepted | DescribeStopRefused | DescribeRedriveStarted | DescribeRedriveDiverged | DescribeRedriveContinued | DescribeRedriveOperatorPart | DescribeRedriveCancelled | DescribeRedriveResult | DescribeReplayContinueRefused | DescribeHelpRequested | DescribeControlTaken | DescribeControlReturned | DescribeMessageDenied;

export type DescribeClientFrame = DescribeStop | DescribeHint | DescribeCancel | DescribeReplayContinue | DescribeSplitResume;

// ---- execution: /ws/executions/{run_id}

/** Before a request block sends its HTTP request; precedes the identical legacy `api_request` frame. */
export type ExecutionApiRequest = {
  block_id: string;
  /** Block name; for a resource of a multi-request block `<block> → <resource>`. */
  block_name: string;
  /** Request body or form fields as sent: any JSON value, null when none; protected values cut out. */
  body: unknown;
  /** Request headers sent, protected values cut out. */
  headers: Record<string, string>;
  /** HTTP method. */
  method: string;
  /** UTC ISO 8601, set at send. */
  timestamp: string;
  type: "execution:api_request";
  /** Resolved request URL, protected values cut out. */
  url: string;
};
export type ExecutionApiRequestBody = Omit<ExecutionApiRequest, "type">;

/** Before a request block sends its HTTP request; legacy twin sent right after `execution:api_request`. */
export type ExecutionApiRequestLegacy = {
  block_id: string;
  /** Block name; for a resource of a multi-request block `<block> → <resource>`. */
  block_name: string;
  /** Request body or form fields as sent: any JSON value, null when none; protected values cut out. */
  body: unknown;
  /** Request headers sent, protected values cut out. */
  headers: Record<string, string>;
  /** HTTP method. */
  method: string;
  /** UTC ISO 8601, set at send. */
  timestamp: string;
  type: "api_request";
  /** Resolved request URL, protected values cut out. */
  url: string;
};
export type ExecutionApiRequestLegacyBody = Omit<ExecutionApiRequestLegacy, "type">;

/** After a request block receives its HTTP response; precedes the identical legacy `api_response` frame. */
export type ExecutionApiResponse = {
  block_id: string;
  /** Block name; for a resource of a multi-request block `<block> → <resource>`. */
  block_name: string;
  /** Parsed response body: any JSON value or null; protected values cut out. */
  body: unknown;
  /** Request duration. */
  duration_ms: number;
  /** Response headers, protected values cut out. */
  headers: Record<string, string>;
  /** HTTP status. */
  status_code: number;
  /** Reason phrase for common codes, else `Unknown`. */
  status_text: string;
  /** UTC ISO 8601, set at send. */
  timestamp: string;
  type: "execution:api_response";
};
export type ExecutionApiResponseBody = Omit<ExecutionApiResponse, "type">;

/** After a request block receives its HTTP response; legacy twin sent right after `execution:api_response`. */
export type ExecutionApiResponseLegacy = {
  block_id: string;
  /** Block name; for a resource of a multi-request block `<block> → <resource>`. */
  block_name: string;
  /** Parsed response body: any JSON value or null; protected values cut out. */
  body: unknown;
  /** Request duration. */
  duration_ms: number;
  /** Response headers, protected values cut out. */
  headers: Record<string, string>;
  /** HTTP status. */
  status_code: number;
  /** Reason phrase for common codes, else `Unknown`. */
  status_text: string;
  /** UTC ISO 8601, set at send. */
  timestamp: string;
  type: "api_response";
};
export type ExecutionApiResponseLegacyBody = Omit<ExecutionApiResponseLegacy, "type">;

/** When the execution is cancelled; precedes the identical legacy `execution_complete` frame. */
export type ExecutionComplete = {
  /** Always 0. */
  duration_ms: number;
  status: "cancelled";
  /** Always empty. */
  summary: Record<string, unknown>;
  /** UTC ISO 8601, set at send. */
  timestamp: string;
  type: "execution:execution_complete";
};
export type ExecutionCompleteBody = Omit<ExecutionComplete, "type">;

/** When the execution is cancelled; legacy twin sent right after `execution:execution_complete`. */
export type ExecutionCompleteLegacy = {
  /** Always 0. */
  duration_ms: number;
  status: "cancelled";
  /** Always empty. */
  summary: Record<string, unknown>;
  /** UTC ISO 8601, set at send. */
  timestamp: string;
  type: "execution_complete";
};
export type ExecutionCompleteLegacyBody = Omit<ExecutionCompleteLegacy, "type">;

/** Sent after 30 s without a client frame. */
export type ExecutionHeartbeat = {
  /** UTC ISO 8601, set at send. */
  timestamp: string;
  type: "heartbeat";
};
export type ExecutionHeartbeatBody = Omit<ExecutionHeartbeat, "type">;

/** Reply to a `ping` text frame. */
export type ExecutionPong = "pong";

/** Client keep-alive; any other text frame is ignored. */
export type ExecutionPing = "ping";

/** Live HTTP requests and responses of one project execution. No credentials are presented. Accepted for any `run_id`; nothing is replayed, and every event is sent twice: `execution:<event>`, then legacy `<event>`. */
export type ExecutionServerFrame = ExecutionApiRequest | ExecutionApiRequestLegacy | ExecutionApiResponse | ExecutionApiResponseLegacy | ExecutionComplete | ExecutionCompleteLegacy | ExecutionHeartbeat;

export type ExecutionClientFrame = never;

// ---- flowGeneration: /ws/flow-generation/{run_id}

/** A pipeline step started; also the replay on connect while the run is running. */
export type FlowGenerationProgress = {
  payload: {
    /** Pipeline node name, e.g. analyze_schemas, generate_flow, validate_flow; may be empty or initializing in the replay. */
    current_step: string;
    /** Percent. */
    progress: number;
    status: "in_progress";
    /** Human-readable step; falls back to current_step. */
    step_label: string;
  };
  type: "flow-generation:progress";
};
export type FlowGenerationProgressBody = FlowGenerationProgress["payload"];

/** The flow was generated and saved; also the replay on connect for a completed run. */
export type FlowGenerationComplete = {
  payload: {
    /** Always 0 in the replay. */
    blocks_count: number;
    /** Created or regenerated flow; may be empty in the replay. */
    flow_id: string;
    run_id: string;
    status: "completed";
  };
  type: "flow-generation:complete";
};
export type FlowGenerationCompleteBody = FlowGenerationComplete["payload"];

/** The run failed; also the replay on connect for a failed run. */
export type FlowGenerationError = {
  payload: {
    /** User-facing failure. */
    error: string;
    /** Running again may succeed; always false in the replay. */
    recoverable: boolean;
  };
  type: "flow-generation:error";
};
export type FlowGenerationErrorBody = FlowGenerationError["payload"];

/** The run was cancelled (after a client cancel, and again when the pipeline stops); also the replay on connect for a cancelled run. */
export type FlowGenerationCancelled = {
  payload: {
    run_id: string;
  };
  type: "flow-generation:cancelled";
};
export type FlowGenerationCancelledBody = FlowGenerationCancelled["payload"];

/** Client asks to cancel the run; ignored once the run has ended, otherwise answered with flow-generation:cancelled. */
export type FlowGenerationCancel = {
  type: "flow-generation:cancel";
};
export type FlowGenerationCancelBody = Omit<FlowGenerationCancel, "type">;

/** Progress of one flow generation (POST /api/v1/projects/{project_id}/flows/generate-async) or regeneration (POST .../flows/{flow_id}/regenerate). On connect the server sends one frame of the stored run state: progress if running, complete/error/cancelled if ended, nothing if pending or unknown; the socket is never closed by the server. No credentials are presented. */
export type FlowGenerationServerFrame = FlowGenerationProgress | FlowGenerationComplete | FlowGenerationError | FlowGenerationCancelled;

export type FlowGenerationClientFrame = FlowGenerationCancel;

// ---- gatlingExecution: /ws/gatling/executions/{execution_id}

/** Run phase changed (sent first, followed by its unprefixed duplicate). */
export type GatlingExecutionStatusUpdate = {
  /** Human-readable phase text; may be empty. */
  message: string;
  status: "building" | "running" | "completed" | "failed";
  /** Server send time, ISO 8601 UTC. */
  timestamp: string;
  type: "gatling:status_update";
};
export type GatlingExecutionStatusUpdateBody = Omit<GatlingExecutionStatusUpdate, "type">;

/** Run phase changed (legacy duplicate, sent right after the gatling:-prefixed frame). */
export type GatlingExecutionLegacyStatusUpdate = {
  /** Human-readable phase text; may be empty. */
  message: string;
  status: "building" | "running" | "completed" | "failed";
  /** Server send time, ISO 8601 UTC. */
  timestamp: string;
  type: "status_update";
};
export type GatlingExecutionLegacyStatusUpdateBody = Omit<GatlingExecutionLegacyStatusUpdate, "type">;

/** Run log line emitted (sent first, followed by its unprefixed duplicate). */
export type GatlingExecutionLog = {
  level: "info" | "warning" | "error";
  /** One run-log line. */
  message: string;
  /** Server send time, ISO 8601 UTC. */
  timestamp: string;
  type: "gatling:log";
};
export type GatlingExecutionLogBody = Omit<GatlingExecutionLog, "type">;

/** Run log line emitted (legacy duplicate, sent right after the gatling:-prefixed frame). */
export type GatlingExecutionLegacyLog = {
  level: "info" | "warning" | "error";
  /** One run-log line. */
  message: string;
  /** Server send time, ISO 8601 UTC. */
  timestamp: string;
  type: "log";
};
export type GatlingExecutionLegacyLogBody = Omit<GatlingExecutionLegacyLog, "type">;

/** Execution reached a terminal status (sent first, followed by its unprefixed duplicate). Socket stays open. */
export type GatlingExecutionComplete = {
  /** Final status; re-read the execution row for results. */
  status: "completed" | "failed" | "cancelled";
  /** Server send time, ISO 8601 UTC. */
  timestamp: string;
  type: "gatling:execution_complete";
};
export type GatlingExecutionCompleteBody = Omit<GatlingExecutionComplete, "type">;

/** Execution reached a terminal status (legacy duplicate, sent right after the gatling:-prefixed frame). Socket stays open. */
export type GatlingExecutionLegacyComplete = {
  /** Final status; re-read the execution row for results. */
  status: "completed" | "failed" | "cancelled";
  /** Server send time, ISO 8601 UTC. */
  timestamp: string;
  type: "execution_complete";
};
export type GatlingExecutionLegacyCompleteBody = Omit<GatlingExecutionLegacyComplete, "type">;

/** No client text frame received for 30 s. */
export type GatlingExecutionHeartbeat = {
  /** Server send time, ISO 8601 UTC. */
  timestamp: string;
  type: "heartbeat";
};
export type GatlingExecutionHeartbeatBody = Omit<GatlingExecutionHeartbeat, "type">;

/** Every ~1 s while the run has counted requests (Prometheus read succeeded). */
export type GatlingLiveMetrics = {
  data: {
    /** In-flight gauge, else throughput x mean latency. */
    active_users: number;
    /** ko_count / total_requests, 0..1. */
    error_rate: number;
    /** Request count per HTTP status code; a failure without a status is keyed by its KO limb (e.g. no_response); 'unknown' when no status label. */
    http_status_counts: Record<string, number>;
    /** Load injector CPU utilization; null when not sampled. */
    injector_cpu_utilization: number | null;
    /** Injector memory used / limit, 0..1; null when not sampled. */
    injector_memory_utilization: number | null;
    ko_count: number;
    /** 99.9th percentile histogram estimate, not a true max, ms. */
    max_response_time: number;
    /** Cumulative mean, ms. */
    mean_response_time: number;
    ok_count: number;
    /** Histogram estimate (histogram_quantile over 30 s rate window), ms. */
    p50_histogram: number;
    /** Histogram estimate (histogram_quantile over 30 s rate window), ms. */
    p75_histogram: number;
    /** Histogram estimate (histogram_quantile over 30 s rate window), ms. */
    p90_histogram: number;
    /** Histogram estimate (histogram_quantile over 30 s rate window), ms. */
    p95_histogram: number;
    /** Always 0. */
    p999: 0;
    /** Always 0. */
    p9999: 0;
    /** Histogram estimate (histogram_quantile over 30 s rate window), ms. */
    p99_histogram: number;
    /** Requests/s over 30 s. */
    rps: number;
    /** Snapshot time, Unix epoch ms. */
    timestamp: number;
    /** Cumulative requests. */
    total_requests: number;
  };
  type: "live_metrics";
};
export type GatlingLiveMetricsBody = Omit<GatlingLiveMetrics, "type">;

/** Every 3rd tick (~3 s) when any endpoint has counted requests. */
export type GatlingLivePerRequest = {
  /** One row per request name. */
  data: ({
    count: number;
    /** 0..1. */
    error_rate: number;
    /** Request count per HTTP status code; a failure without a status is keyed by its KO limb (e.g. no_response); 'unknown' when no status label. */
    http_status_counts: Record<string, number>;
    ko_count: number;
    /** Always null (not measured live). */
    max_response_time: number | null;
    max_source: "not-measured";
    /** ms. */
    mean_response_time: number;
    /** Always null (not measured live). */
    min_response_time: number | null;
    min_source: "not-measured";
    /** Gatling request name. */
    name: string;
    ok_count: number;
    /** Histogram estimate (histogram_quantile over 30 s rate window), ms. */
    p50_histogram: number;
    /** Histogram estimate (histogram_quantile over 30 s rate window), ms. */
    p75_histogram: number;
    /** Histogram estimate (histogram_quantile over 30 s rate window), ms. */
    p90_histogram: number;
    /** Histogram estimate (histogram_quantile over 30 s rate window), ms. */
    p95_histogram: number;
    /** Histogram estimate (histogram_quantile over 30 s rate window), ms. */
    p99_histogram: number;
    /** Requests/s over 30 s. */
    rps: number;
  })[];
  type: "live_per_request";
};
export type GatlingLivePerRequestBody = Omit<GatlingLivePerRequest, "type">;

/** An error row appeared or its count changed since the previous tick. */
export type GatlingLiveError = {
  data: {
    /** Cumulative count for this id. */
    count: number;
    /** Same as id. */
    error_hash: string;
    /** Epoch ms; equals timestamp. */
    first_seen: number;
    /** "<request_name>::<status or limb>"; replace the earlier row with the same id. */
    id: string;
    ko_limb: "http_status" | "no_response" | "unmet_check" | "non_http_transport";
    /** Epoch ms; equals timestamp. */
    last_seen: number;
    /** "HTTP <status>" or the KO limb name. */
    message: string;
    request_name: string;
    status_code: number | null;
    /** Unix epoch ms. */
    timestamp: number;
  };
  type: "live_error";
};
export type GatlingLiveErrorBody = Omit<GatlingLiveError, "type">;

/** Reply to a client "ping" text frame. */
export type GatlingExecutionPong = "pong";

/** Client keepalive; server answers "pong". Any other text is ignored. */
export type GatlingExecutionPing = "ping";

/** Live updates of one Gatling execution: phase, run log, terminal status, and Prometheus-derived live metrics. Handshake requires query project_id (owning the execution) and token (>=16 chars); denial closes before accept. No state replay on connect; status/log/complete frames are sent twice (gatling:-prefixed, then unprefixed). Server never closes after completion. */
export type GatlingExecutionServerFrame = GatlingExecutionStatusUpdate | GatlingExecutionLegacyStatusUpdate | GatlingExecutionLog | GatlingExecutionLegacyLog | GatlingExecutionComplete | GatlingExecutionLegacyComplete | GatlingExecutionHeartbeat | GatlingLiveMetrics | GatlingLivePerRequest | GatlingLiveError;

export type GatlingExecutionClientFrame = never;

// ---- gatlingExecutionLive: /ws/gatling/executions/{execution_id}/live

/** Alias of /ws/gatling/executions/{execution_id}: same handler, checks and frames. Handshake requires query project_id (owning the execution) and token (>=16 chars); denial closes before accept. No state replay on connect; status/log/complete frames are sent twice (gatling:-prefixed, then unprefixed). Server never closes after completion. */
export type GatlingExecutionLiveServerFrame = GatlingExecutionStatusUpdate | GatlingExecutionLegacyStatusUpdate | GatlingExecutionLog | GatlingExecutionLegacyLog | GatlingExecutionComplete | GatlingExecutionLegacyComplete | GatlingExecutionHeartbeat | GatlingLiveMetrics | GatlingLivePerRequest | GatlingLiveError;

export type GatlingExecutionLiveClientFrame = never;

// ---- gatlingFeeder: /ws/gatling-feeder/{run_id}

/** Generation step started (prepare 10, generate 35, format 70, save 90). */
export type GatlingFeederProgress = {
  payload: {
    current_step: "prepare" | "generate" | "format" | "save";
    /** Percent. */
    progress: number;
    status: "in_progress";
    /** Display label for current_step. */
    step_label: string;
  };
  type: "gatling-feeder:progress";
};
export type GatlingFeederProgressBody = GatlingFeederProgress["payload"];

/** Feeder saved; terminal frame of the run. */
export type GatlingFeederComplete = {
  payload: {
    /** Created feeder id. */
    feeder_id: string;
    run_id: string;
    status: "completed";
  };
  type: "gatling-feeder:complete";
};
export type GatlingFeederCompleteBody = GatlingFeederComplete["payload"];

/** Generation failed; terminal frame of the run. */
export type GatlingFeederError = {
  payload: {
    /** User-facing failure reason. */
    error: string;
    /** Whether rerunning can help. */
    recoverable: boolean;
  };
  type: "gatling-feeder:error";
};
export type GatlingFeederErrorBody = GatlingFeederError["payload"];

/** Column regeneration request accepted, before generation runs. */
export type GatlingFeederSourceDecided = {
  payload: {
    column_name: string;
    /** Source config as sent in the request. */
    config: Record<string, unknown>;
    feeder_id: string;
    source: "faker" | "llm" | "enum" | "uuid" | "range";
  };
  type: "feeder.source_decided";
};
export type GatlingFeederSourceDecidedBody = GatlingFeederSourceDecided["payload"];

/** Column regenerated successfully. */
export type GatlingFeederRecipeReceived = {
  payload: {
    column_name: string;
    feeder_id: string;
    llm_cost_usd: number;
    /** Up to 20 updated rows, secret columns redacted. */
    sample_rows_preview: Record<string, unknown>[];
  };
  type: "feeder.recipe_received";
};
export type GatlingFeederRecipeReceivedBody = GatlingFeederRecipeReceived["payload"];

/** Column regenerated with warnings; follows feeder.recipe_received. */
export type GatlingFeederBudgetFallback = {
  payload: {
    column_name: string;
    feeder_id: string;
    warnings: string[];
  };
  type: "feeder.budget_fallback";
};
export type GatlingFeederBudgetFallbackBody = GatlingFeederBudgetFallback["payload"];

/** Column regeneration failed. */
export type GatlingFeederValidationFailed = {
  payload: {
    /** Failure reason. */
    detail: string;
    feeder_id: string;
    stage: "column_regeneration";
  };
  type: "feeder.validation_failed";
};
export type GatlingFeederValidationFailedBody = GatlingFeederValidationFailed["payload"];

/** Progress of AI feeder generation (run_id from POST /api/v1/projects/{project_id}/gatling/feeders/generate-async) and column-regeneration events (run_id chosen by the client in POST .../feeders/{feeder_id}/regenerate-column). Accepted immediately; frames sent before connect are lost. No credentials are presented. */
export type GatlingFeederServerFrame = GatlingFeederProgress | GatlingFeederComplete | GatlingFeederError | GatlingFeederSourceDecided | GatlingFeederRecipeReceived | GatlingFeederBudgetFallback | GatlingFeederValidationFailed;

export type GatlingFeederClientFrame = never;

// ---- har: /ws/projects/{project_id}/har/{session_id}

/** A step of an upload, analyze or generate run starts or ends. */
export type HarProgress = {
  payload: {
    /** Upload: validate, classify_noise, build_results. Analyze: prepare, group. Generate: generate_flow. */
    current_step: "validate" | "classify_noise" | "build_results" | "prepare" | "group" | "generate_flow";
    /** Percent, 0-100. */
    progress: number;
    /** in_progress: upload/analyze step; running/completed: generate step. */
    status: "in_progress" | "running" | "completed";
    /** 0-based index within the run's steps. */
    step_index: number;
    /** Human-readable step text. */
    step_label: string;
    /** 3 upload, 2 analyze, 1 generate. */
    total_steps: number;
  };
  type: "har:progress";
};
export type HarProgressBody = HarProgress["payload"];

/** A run finished; payload fields depend on the request: har:upload, har:analyze or har:generate. */
export type HarComplete = {
  payload: {
    /** Analyze only. Entries grouped into user actions. */
    action_groups?: ({
      /** Session variable names. */
      correlations_consumed: string[];
      /** Session variable names. */
      correlations_produced: string[];
      end_index: number;
      /** Per entry: method, path, status. */
      entries_summary: Record<string, unknown>[];
      entry_indices: number[];
      name: string;
      start_index: number;
      think_time_before_ms: number | null;
    })[];
    /** Analyze only. Request locations left uncorrelated (locations and paths, no values). */
    ambiguous_producers?: Record<string, unknown>[];
    /** Analyze only. */
    auth_flows?: Record<string, unknown>[];
    /** Upload only. Detected API base URL; may be empty. */
    base_url?: string;
    /** Generate only. */
    block_count?: number;
    /** Analyze only. What the evidence supports. */
    capability_profile?: Record<string, boolean>;
    /** Analyze only. Values a response produces and a later request uses. */
    correlations?: ({
      cardinality: "scalar" | "collection";
      /** 0.0-1.0. */
      confidence: number;
      correlation_type: "embedded" | null;
      /** Collection sources: element each virtual user picks. */
      selection: ({
        index?: number | null;
        strategy?: "random" | "first" | "last" | "index" | "all";
      }) | null;
      source_entry_index: number;
      /** JSONPath in the source response. */
      source_json_path: string;
      source_kind: "create_response" | "detail_response" | "poll_response" | "other_response" | "list_response";
      source_priority: number;
      suggested_session_var: string;
      target_entry_index: number;
      /** E.g. header:Authorization, body:$.id, path:2, query:id. */
      target_location: string;
      /** Truncated value; secret-like values are masked. */
      value_preview: string;
    })[];
    /** Upload only. E.g. bearer_token, cookie_session, basic_auth. */
    detected_auth_pattern?: string | null;
    /** Upload only. */
    domain_stats?: {
      /** XHR/fetch entries with JSON response. */
      api_count: number;
      domain: string;
      /** Detected primary API domain. */
      is_primary: boolean;
      noise_entry_count: number;
      total_count: number;
    }[];
    /** Upload only. Recording duration. */
    duration_ms?: number;
    /** Generate only. */
    edge_count?: number;
    /** Analyze only. Ratios 0.0-1.0. */
    evidence_coverage?: Record<string, number>;
    /** Analyze only. */
    evidence_quality?: "full" | "partial" | "weak_response";
    /** Upload only. Entries auto-excluded as noise. */
    excluded_count?: number;
    /** Analyze only. Entries auto-excluded as noise. */
    excluded_entries?: ({
      domain?: string;
      index?: number;
      method?: string;
      noise_reasons?: string[];
      noise_score?: number | null;
      path?: string;
      status?: number;
    })[];
    /** Upload only. Entries kept after filtering. */
    filtered_entries?: number;
    /** Upload only. ISO time of first entry. */
    first_timestamp?: string | null;
    /** Generate only. First (or only) saved flow. */
    flow_id?: string;
    /** Generate only. */
    flow_name?: string;
    /** Generate only. Every saved flow when a split produced more than one; null otherwise. */
    flows?: {
      block_count: number;
      edge_count: number;
      flow_id: string;
      flow_name: string;
    }[] | null;
    /** Analyze only. */
    graphql_operations?: Record<string, unknown>[];
    /** Upload only. Equals session_id. */
    har_session_id?: string;
    /** Analyze only. Detection summaries. */
    info?: string[];
    /** Upload only. ISO time of last entry. */
    last_timestamp?: string | null;
    /** Analyze only. */
    pagination_patterns?: Record<string, unknown>[];
    /** Analyze only. */
    parallel_groups?: Record<string, unknown>[];
    /** Analyze only. */
    polling_patterns?: Record<string, unknown>[];
    /** Upload and analyze. Project context used for parsing (app_architecture, api_protocol, auth_method, feature flags, known domains, ...). */
    project_profile?: Record<string, unknown>;
    session_id: string;
    status: "completed";
    /** Upload only. Entries in the file. */
    total_entries?: number;
    /** Generate only. Graph degradations, joined. */
    warning?: string | null;
    /** Upload and analyze. Parse warnings, e.g. {code, message}. */
    warnings?: Record<string, string>[];
  };
  type: "har:complete";
};
export type HarCompleteBody = HarComplete["payload"];

/** A run failed, a request was refused, or the message type is unknown; the socket stays open. */
export type HarError = {
  payload: {
    /** User-facing cause. */
    error: string;
    /** Repeating the request may succeed. */
    recoverable: boolean;
  };
  type: "har:error";
};
export type HarErrorBody = HarError["payload"];

/** Reply to har:cancel; also sent when generation stops at a cancel check. */
export type HarCancelled = {
  payload: {
    session_id: string;
  };
  type: "har:cancelled";
};
export type HarCancelledBody = HarCancelled["payload"];

/** Generation found two or more journeys and waits for split_resume. Flat frame, no payload envelope. */
export type HarSplitProposal = {
  proposed_paths: {
    /** Always false. */
    depends_on_prior: boolean;
    name: string;
    rationale: string;
    /** Request labels `METHOD /path`, in flow order. */
    steps: string[];
  }[];
  type: "split_proposal";
};
export type HarSplitProposalBody = Omit<HarSplitProposal, "type">;

/** Parse a HAR, classify noise with the LLM and cache it under the path session_id; ends in har:complete or har:error. */
export type HarUpload = {
  /** HAR file JSON (`log.entries`). Missing: empty object. */
  har_data?: Record<string, unknown>;
  type: "har:upload";
};
export type HarUploadBody = Omit<HarUpload, "type">;

/** Group a cached session's entries into actions with the LLM; ends in har:complete or har:error. */
export type HarAnalyze = {
  /** Cached session of this project to analyze. Default: path session_id. */
  har_session_id?: string;
  type: "har:analyze";
};
export type HarAnalyzeBody = Omit<HarAnalyze, "type">;

/** Generate and save a flow from the cached session named by the path session_id; ignored while one already runs for it. */
export type HarGenerate = {
  /** Reviewed groups; their order and `entry_indices` set the entry order. */
  action_groups?: {
    entry_indices?: number[];
  }[];
  /** Used once with auth_username; never stored. */
  auth_password?: string;
  /** Used once with auth_password to verify a replayable login; never stored. */
  auth_username?: string;
  /** Final exclusion set over all entries, auto-excluded ones included; absent: the parser's exclusions stand. */
  excluded_entry_indices?: number[];
  /** Default: empty string. */
  flow_name?: string;
  /** Correlations from the analyze result to drop; each must be one it listed, else har:error. */
  rejected_correlations?: {
    source_entry_index: number;
    source_json_path: string;
    target_entry_index: number;
    target_location: string;
  }[];
  type: "har:generate";
};
export type HarGenerateBody = Omit<HarGenerate, "type">;

/** Cancel the session's running analyze or generate; answered at once with har:cancelled. */
export type HarCancel = {
  type: "har:cancel";
};
export type HarCancelBody = Omit<HarCancel, "type">;

/** Approve the (possibly edited) journeys of split_proposal; the paused generation resumes and saves one flow per path. */
export type HarSplitResume = {
  /** Missing: empty list. */
  paths?: {
    /** Flow name of the path. */
    name?: string;
    /** Name composed by the client, not typed by the user; a single remaining flow then takes flow_name. */
    name_generated?: boolean;
    /** Step labels from the proposal, regrouped; an unknown label fails the run. */
    steps?: string[];
  }[];
  type: "split_resume";
};
export type HarSplitResumeBody = Omit<HarSplitResume, "type">;

/** Runs HAR import steps on request (upload, analyze, generate) and streams their progress and results; generation can pause for journey-split approval. Nothing is sent on connect. Handshake requires a principal that is at least a viewer of the project. */
export type HarServerFrame = HarProgress | HarComplete | HarError | HarCancelled | HarSplitProposal;

export type HarClientFrame = HarUpload | HarAnalyze | HarGenerate | HarCancel | HarSplitResume;

// ---- healthCheck: /ws/health-check/{session_id}

/** A pipeline node starts or ends. Flat frame. */
export type HealthCheckProgress = {
  /** Always empty. */
  details: Record<string, unknown>;
  node: "extract_endpoints" | "compare" | "recommend";
  /** Percent: 20, 50, 60, 100. */
  progress: number;
  status: "running" | "completed";
  type: "progress";
};
export type HealthCheckProgressBody = Omit<HealthCheckProgress, "type">;

/** Check finished with its report. Flat frame. */
export type HealthCheckComplete = {
  result: {
    checked_at: string;
    covered_endpoints: ({
      drift_details: string[] | null;
      method: string;
      path_template: string;
      status: "current" | "modified" | "removed";
    })[];
    parameter_drifts: ({
      change_description: string;
      endpoint: string;
      new_value_type: string | null;
      old_value_type: string | null;
      param_location: "query" | "header" | "body";
      param_name: string;
    })[];
    recommendations: string[];
    reference_source: "har" | "openapi";
    scenario_id: string;
    /** 0.0 (current) to 1.0 (stale). */
    staleness_score: number;
    /** Reference endpoints the scenario does not call. */
    uncovered_endpoints: string[];
  };
  type: "complete";
};
export type HealthCheckCompleteBody = Omit<HealthCheckComplete, "type">;

/** Check failed. Flat frame. */
export type HealthCheckError = {
  /** User-facing cause. */
  error: string;
  /** Always null on this channel. */
  node: string | null;
  /** Always null on this channel. */
  technical: string | null;
  type: "error";
};
export type HealthCheckErrorBody = Omit<HealthCheckError, "type">;

/** Reply to cancel. Flat frame. */
export type HealthCheckCancelled = {
  type: "cancelled";
};
export type HealthCheckCancelledBody = Omit<HealthCheckCancelled, "type">;

/** Mark the session cancelled; answered with cancelled. A check already running is not stopped. */
export type HealthCheckCancel = {
  type: "cancel";
};
export type HealthCheckCancelBody = Omit<HealthCheckCancel, "type">;

/** Streams a health check started by POST /api/scenarios/{scenario_id}/health-check. No credentials are presented. Nothing is sent on connect and earlier frames are not replayed. */
export type HealthCheckServerFrame = HealthCheckProgress | HealthCheckComplete | HealthCheckError | HealthCheckCancelled;

export type HealthCheckClientFrame = HealthCheckCancel;

// ---- liveView: /ws/projects/{project_id}/scenario-from-description/runs/{run_id}/live

/** State of the watched path: no agent browser is open. */
export type LiveViewNoBrowser = {
  path_index: number;
  type: "no_browser";
};
export type LiveViewNoBrowserBody = Omit<LiveViewNoBrowser, "type">;

/** State: browser open, nothing to show yet. */
export type LiveViewOpening = {
  /** Drive attempt. */
  attempt: number;
  /** Lease state; absent while the agent steers. */
  lease?: "taking" | "human" | "handing_back";
  path_index: number;
  type: "opening";
};
export type LiveViewOpeningBody = Omit<LiveViewOpening, "type">;

/** State: page on the project's target addresses; binary frames follow on repaint. */
export type LiveViewLive = {
  /** Drive attempt. */
  attempt: number;
  /** Lease state; absent while the agent steers. */
  lease?: "taking" | "human" | "handing_back";
  path_index: number;
  type: "live";
};
export type LiveViewLiveBody = Omit<LiveViewLive, "type">;

/** State: page on a host outside the target addresses; no pixels are sent. */
export type LiveViewBlocked = {
  /** Drive attempt. */
  attempt: number;
  /** Blocked host. */
  host: string;
  /** Lease state; absent while the agent steers. */
  lease?: "taking" | "human" | "handing_back";
  path_index: number;
  type: "blocked";
};
export type LiveViewBlockedBody = Omit<LiveViewBlocked, "type">;

/** State: page has no host (about:blank, data:). */
export type LiveViewBlankPage = {
  /** Drive attempt. */
  attempt: number;
  /** Lease state; absent while the agent steers. */
  lease?: "taking" | "human" | "handing_back";
  path_index: number;
  type: "blank_page";
};
export type LiveViewBlankPageBody = Omit<LiveViewBlankPage, "type">;

/** Reply to `watch` with a bad field. */
export type LiveViewInvalidWatch = {
  /** Invalid field. */
  reason: "path_index" | "tile_width";
  type: "invalid_watch";
};
export type LiveViewInvalidWatchBody = Omit<LiveViewInvalidWatch, "type">;

/** One screencast frame of the watched path, when the page repaints (max 5/s; 15/s while the user steers). */
export type LiveViewFrame = Uint8Array;

/** Reply to `take_control`: refused. */
export type LiveViewTakeRefused = {
  code: "take_invalid_message" | "take_run_ended" | "take_no_browser" | "take_attempt_not_current" | "take_not_live" | "take_stopping" | "take_already_taken" | "take_replay_running" | "take_replay_choice_pending" | "take_address_blocked";
  /** path_index echoed from the request as sent (any JSON value, or null). */
  path_index: unknown;
  type: "take_refused";
};
export type LiveViewTakeRefusedBody = Omit<LiveViewTakeRefused, "type">;

/** A lease message was refused (claim_control, hand_back, or a steering message from a non-holder). */
export type LiveViewLeaseRefused = {
  code: "lease_invalid_message" | "lease_unknown_token" | "lease_returned" | "lease_not_holder" | "lease_journey_blocked";
  /** Type of the refused message. */
  message_type: string;
  type: "lease_refused";
};
export type LiveViewLeaseRefusedBody = Omit<LiveViewLeaseRefused, "type">;

/** To the lease holder only: the user now steers; carries the lease token (also re-sent on a successful claim_control). */
export type LiveViewControlGranted = {
  attempt: number;
  /** Why hand-back as journey is not allowed (a secret was typed); null otherwise. */
  forced: ({
    forced_by: "one_time_code" | "payment" | "password_not_account" | "unreadable";
    obstacle_kind: "captcha" | "one_time_code" | "payment" | "other";
  }) | null;
  /** When the browser returns to the agent without input (UTC). */
  idle_deadline_at: string;
  /** Inactivity wait, seconds. */
  idle_wait_s: number;
  /** Obstacle the hand-back dialog offers first. */
  obstacle_kind: "captcha" | "one_time_code" | "payment" | "other";
  path_index: number;
  /** Lease token; present it in claim_control after a reconnect. */
  token: string;
  type: "control_granted";
};
export type LiveViewControlGrantedBody = Omit<LiveViewControlGranted, "type">;

/** To the (former) holder: its lease ended. */
export type LiveViewControlEnded = {
  attempt: number;
  path_index: number;
  /** moved: another connection claimed the token. */
  reason: "handed_back" | "inactivity" | "drive_ended" | "moved";
  type: "control_ended";
};
export type LiveViewControlEndedBody = Omit<LiveViewControlEnded, "type">;

/** To the holder: lease status after each accepted input and when the allowed hand-back changes. */
export type LiveViewControlIdle = {
  /** Why hand-back as journey is not allowed (a secret was typed); null otherwise. */
  forced: ({
    forced_by: "one_time_code" | "payment" | "password_not_account" | "unreadable";
    obstacle_kind: "captcha" | "one_time_code" | "payment" | "other";
  }) | null;
  /** When the browser returns to the agent without input (UTC). */
  idle_deadline_at: string;
  /** Inactivity wait, seconds. */
  idle_wait_s: number;
  /** Obstacle the hand-back dialog offers first. */
  obstacle_kind: "captcha" | "one_time_code" | "payment" | "other";
  path_index: number;
  type: "control_idle";
};
export type LiveViewControlIdleBody = Omit<LiveViewControlIdle, "type">;

/** To the holder: an input, choose_option or answer_dialog did not reach the page. */
export type LiveViewInputRefused = {
  code: "input_not_allowed" | "input_key_not_allowed" | "input_too_long" | "input_too_fast" | "input_use_the_list" | "input_dialog_open" | "input_page_not_shown" | "input_failed" | "choice_invalid_message" | "choice_list_changed" | "dialog_invalid_message" | "dialog_nothing_open" | "dialog_too_long";
  path_index: number;
  type: "input_refused";
};
export type LiveViewInputRefusedBody = Omit<LiveViewInputRefused, "type">;

/** To the holder: a navigate request failed, or a navigation/window left the target addresses. */
export type LiveViewNavigationRefused = {
  code: "navigation_invalid_message" | "navigation_path_refused" | "navigation_address_refused" | "navigation_no_target" | "navigation_no_previous_page" | "navigation_not_opened";
  /** Refused host; with navigation_address_refused. */
  host?: string;
  path_index: number;
  type: "navigation_refused";
};
export type LiveViewNavigationRefusedBody = Omit<LiveViewNavigationRefused, "type">;

/** To the holder: a single <select> was activated; answer with choose_option. */
export type LiveViewSelectOptions = {
  /** Accessible label; may be empty. */
  label: string;
  /** List id for choose_option. */
  nonce: number;
  options: {
    disabled: boolean;
    selected: boolean;
    text: string;
    value: string;
  }[];
  path_index: number;
  /** Box in page CSS px. */
  rect: {
    height: number;
    width: number;
    x: number;
    y: number;
  };
  type: "select_options";
};
export type LiveViewSelectOptionsBody = Omit<LiveViewSelectOptions, "type">;

/** To the holder: the page opened a file chooser; answer with send_file. */
export type LiveViewFileRequested = {
  /** Field label. */
  field_name: string | null;
  nonce: number;
  path_index: number;
  type: "file_requested";
};
export type LiveViewFileRequestedBody = Omit<LiveViewFileRequested, "type">;

/** To the holder: send_file refused. */
export type LiveViewFileRefused = {
  code: "file_invalid_message" | "file_nothing_asked" | "file_too_large";
  path_index: number;
  type: "file_refused";
};
export type LiveViewFileRefusedBody = Omit<LiveViewFileRefused, "type">;

/** To the holder: the file was set on the field. */
export type LiveViewFileSent = {
  name: string;
  nonce: number;
  path_index: number;
  /** Bytes. */
  size: number;
  type: "file_sent";
};
export type LiveViewFileSentBody = Omit<LiveViewFileSent, "type">;

/** To the holder: the page opened a dialog; answer with answer_dialog. */
export type LiveViewPageDialog = {
  /** Prompt default; null for other kinds. */
  default_value: string | null;
  /** Host of the page. */
  host: string;
  kind: "alert" | "confirm" | "prompt";
  /** Dialog text, max 300 chars. */
  message: string;
  nonce: number;
  path_index: number;
  type: "page_dialog";
};
export type LiveViewPageDialogBody = Omit<LiveViewPageDialog, "type">;

/** To the holder: reply to answer_dialog, the dialog closed. */
export type LiveViewPageDialogClosed = {
  nonce: number;
  path_index: number;
  type: "page_dialog_closed";
};
export type LiveViewPageDialogClosedBody = Omit<LiveViewPageDialogClosed, "type">;

/** A client message was not handled. */
export type LiveViewMessageDenied = {
  /** Socket closes after project_access_denied (4003) and run_not_found (4404). */
  code: "editor_role_required" | "project_access_denied" | "run_not_found" | "unknown_message_type" | "malformed_message";
  /** `type` of the refused message; null if absent or not a string. */
  message_type: string | null;
  type: "message_denied";
};
export type LiveViewMessageDeniedBody = Omit<LiveViewMessageDenied, "type">;

/** Watch a path: replaces the previous watch; the server answers with its state, then frames. View message. */
export type LiveViewWatch = {
  /** Path to watch, >= 0. */
  path_index: number;
  /** Tile width in physical px, >= 1; capped at 1920. */
  tile_width: number;
  type: "watch";
};
export type LiveViewWatchBody = Omit<LiveViewWatch, "type">;

/** Take control of the path's browser; granted with control_granted, refused with take_refused. Control message: needs editor role and run ownership, re-checked per message. */
export type LiveViewTakeControl = {
  /** Drive attempt currently live. */
  attempt: number;
  path_index: number;
  type: "take_control";
};
export type LiveViewTakeControlBody = Omit<LiveViewTakeControl, "type">;

/** Reclaim a lease after a reconnect by showing its token; the previous holder gets control_ended moved. Control message: needs editor role and run ownership, re-checked per message. */
export type LiveViewClaimControl = {
  /** Lease token from control_granted. */
  token: string;
  type: "claim_control";
};
export type LiveViewClaimControlBody = Omit<LiveViewClaimControl, "type">;

/** Give the browser back to the agent, saying what the part was. Holder only. Control message: needs editor role and run ownership, re-checked per message. */
export type LiveViewHandBack = {
  choice: "journey" | "obstacle";
  /** Plan step indexes the part covered; default []. */
  covered_steps?: number[];
  /** Required with obstacle; must be absent or null with journey. */
  obstacle_kind?: "captcha" | "one_time_code" | "payment" | "other";
  path_index: number;
  type: "hand_back";
};
export type LiveViewHandBackBody = Omit<LiveViewHandBack, "type">;

/** One mouse, wheel, text or key event for the page; accepted input answers control_idle. Holder only. Control message: needs editor role and run ownership, re-checked per message. */
export type LiveViewInput = {
  /** mouse_down/up; default left. */
  button?: "left";
  /** mouse_down/up; 1-3, default 1. */
  click_count?: number;
  /** wheel. */
  delta_x?: number;
  /** wheel. */
  delta_y?: number;
  /** key: Enter, Tab, Backspace, Delete, Escape, arrows, Home, End, PageUp, PageDown, space, F4, or a-z (except r,l,t,n,w) with Control/Meta. */
  key?: string;
  kind: "mouse_move" | "mouse_down" | "mouse_up" | "wheel" | "insert_text" | "key";
  /** Held modifiers; default []. */
  modifiers?: ("Alt" | "Control" | "Meta" | "Shift")[];
  path_index: number;
  /** insert_text; 1-1000 code points. */
  text?: string;
  type: "input";
  /** CSS px of the frame (mouse, wheel); clamped to 1920x1080. */
  x?: number;
  /** CSS px (mouse, wheel). */
  y?: number;
};
export type LiveViewInputBody = Omit<LiveViewInput, "type">;

/** Navigate the steered page within the target addresses. Holder only. Control message: needs editor role and run ownership, re-checked per message. */
export type LiveViewNavigate = {
  action: "go_to_path" | "reload" | "back";
  /** go_to_path: absolute path on the target origin, starting with /, max 2000 chars. */
  path?: string;
  path_index: number;
  type: "navigate";
};
export type LiveViewNavigateBody = Omit<LiveViewNavigate, "type">;

/** Pick an option of the list from select_options. Holder only. Control message: needs editor role and run ownership, re-checked per message. */
export type LiveViewChooseOption = {
  /** Option index. */
  index: number;
  /** nonce of select_options. */
  nonce: number;
  path_index: number;
  type: "choose_option";
};
export type LiveViewChooseOptionBody = Omit<LiveViewChooseOption, "type">;

/** Answer file_requested with a file. Holder only. Control message: needs editor role and run ownership, re-checked per message. */
export type LiveViewSendFile = {
  /** Base64 content, max 10 MiB decoded. */
  data: string;
  mime_type: string;
  /** File name. */
  name: string;
  /** nonce of file_requested. */
  nonce: number;
  path_index: number;
  type: "send_file";
};
export type LiveViewSendFileBody = Omit<LiveViewSendFile, "type">;

/** Answer page_dialog. Holder only. Control message: needs editor role and run ownership, re-checked per message. */
export type LiveViewAnswerDialog = {
  /** true accepts, false dismisses. */
  accept: boolean;
  /** nonce of page_dialog. */
  nonce: number;
  path_index: number;
  /** Prompt answer, max 1000 chars. */
  text?: string | null;
  type: "answer_dialog";
};
export type LiveViewAnswerDialogBody = Omit<LiveViewAnswerDialog, "type">;

/** Live image of a run's agent browser, one socket per viewer, and the user's take-over of it (lease). Nothing is sent until the client sends watch; then a state frame (no_browser/opening/live/blocked/blank_page) on every change of the path and binary JPEG frames while live. Before accept: Origin must equal the Host (same scheme default port); principal must be a project member with at least viewer role (an API token pinned to another project is refused); the run must be the principal's own. A refused handshake closes before accept (the server answers HTTP 403; browsers report 1006). Credentials: session cookie (or a signed session token in Authorization: Bearer); API tokens and any ?token= query parameter are refused. */
export type LiveViewServerFrame = LiveViewNoBrowser | LiveViewOpening | LiveViewLive | LiveViewBlocked | LiveViewBlankPage | LiveViewInvalidWatch | LiveViewTakeRefused | LiveViewLeaseRefused | LiveViewControlGranted | LiveViewControlEnded | LiveViewControlIdle | LiveViewInputRefused | LiveViewNavigationRefused | LiveViewSelectOptions | LiveViewFileRequested | LiveViewFileRefused | LiveViewFileSent | LiveViewPageDialog | LiveViewPageDialogClosed | LiveViewMessageDenied;

export type LiveViewClientFrame = LiveViewWatch | LiveViewTakeControl | LiveViewClaimControl | LiveViewHandBack | LiveViewInput | LiveViewNavigate | LiveViewChooseOption | LiveViewSendFile | LiveViewAnswerDialog;

// ---- payloadGen: /ws/payload-gen/{run_id}

/** A generation step starts. */
export type PayloadGenProgress = {
  payload: {
    current_step: "prepare" | "generate" | "package";
    /** Percent: prepare 10 (sent twice), generate 30, package 90. */
    progress: number;
    status: "in_progress";
    step_label: string;
  };
  type: "payload-gen:progress";
};
export type PayloadGenProgressBody = PayloadGenProgress["payload"];

/** ZIP is ready for download. */
export type PayloadGenComplete = {
  payload: {
    run_id: string;
    status: "completed";
  };
  type: "payload-gen:complete";
};
export type PayloadGenCompleteBody = PayloadGenComplete["payload"];

/** Generation failed. */
export type PayloadGenError = {
  payload: {
    /** User-facing cause. */
    error: string;
    /** Starting the generation again may succeed. */
    recoverable: boolean;
  };
  type: "payload-gen:error";
};
export type PayloadGenErrorBody = PayloadGenError["payload"];

/** Streams payload generation started by POST /api/v1/projects/{project_id}/generate-payloads-async; after complete the ZIP is fetched from GET /api/v1/projects/{project_id}/generate-payloads/{run_id}/download. No credentials are presented. Nothing is sent on connect and earlier frames are not replayed; client frames are read and discarded. */
export type PayloadGenServerFrame = PayloadGenProgress | PayloadGenComplete | PayloadGenError;

export type PayloadGenClientFrame = never;

// ---- projectExecution: /ws/projects/{project_id}/executions/{execution_id}

/** Sent after 30 s without a client frame. */
export type ProjectExecutionHeartbeat = {
  /** UTC ISO 8601, set at send. */
  timestamp: string;
  type: "heartbeat";
};
export type ProjectExecutionHeartbeatBody = Omit<ProjectExecutionHeartbeat, "type">;

/** Reply to a `ping` text frame. */
export type ProjectExecutionPong = "pong";

/** Client keep-alive; any other text frame is ignored. */
export type ProjectExecutionPing = "ping";

/** Keep-alive socket for one execution run. Before accept it requires a `token` query parameter of at least 16 characters and an execution run `execution_id` whose flow's spec belongs to `project_id`; then sends only heartbeats and pong replies, no run events. */
export type ProjectExecutionServerFrame = ProjectExecutionHeartbeat;

export type ProjectExecutionClientFrame = never;

// ---- projectSetup: /ws/project-setup/{run_id}

/** First frame after accept. */
export type ProjectSetupConnected = {
  payload: {
    run_id: string;
    /** UTC ISO 8601, set at send. */
    timestamp: string;
  };
  type: "project-setup:connected";
};
export type ProjectSetupConnectedBody = ProjectSetupConnected["payload"];

/** Second frame after accept, only when the run exists. */
export type ProjectSetupSnapshot = {
  /** Current run state. */
  payload: {
    /** `error` once failed. */
    current_step: string | null;
    error: string | null;
    flow_id: string | null;
    /** Every log line so far. */
    logs: {
      level: string;
      message: string;
    }[];
    openapi_spec_ids: string[];
    /** queued, analyzing, analysis_complete, creating_project, project_created, completed, analysis_failed, persist_failed or create_and_generate_failed. */
    phase: string;
    progress: number;
    /** Target project (project-scoped run) or the created one. */
    project_id: string | null;
    /** Analysis result; null before it and after a failure. */
    result: ({
      analysis_summary: {
        parse_duration_ms: number;
        sources_parsed: string[];
        warnings: string[];
      };
      /** Draft application description; free-form object. */
      application_description_draft: Record<string, unknown> | null;
      detected_modules: ({
        /** Lower-case path prefix, e.g. `/api/orders`; `/` for root. */
        api_prefix: string;
        confidence: number;
        description: string | null;
        endpoint_count: number;
        name: string | null;
        /** API map part key; null for HAR/LLM modules. */
        part_key: string | null;
        source_kinds: ("user" | "har" | "openapi" | "asyncapi" | "postman" | "preset" | "llm")[];
      })[];
      /** Draft project profile; free-form object. */
      project_profile_draft: Record<string, unknown> | null;
      /** Project-level summary from the LLM. */
      project_summary: string | null;
      readiness: {
        can_create_project: boolean;
        can_generate_scenario: boolean;
        completeness_pct: number;
        /** Inputs missing for scenario generation. */
        missing_for_generation: string[];
        /** Fields required to create the project. */
        missing_required: string[];
      };
      suggested_headers: ({
        name: string;
        source: "user" | "har" | "openapi" | "asyncapi" | "postman" | "preset" | "llm";
        value: string;
      })[];
      suggestions: ({
        confidence: number;
        evidence_refs: string[] | null;
        /** snake_case dotted path, e.g. `project_profile.base_url`. */
        field_path: string;
        rationale: string | null;
        source_kinds: ("user" | "har" | "openapi" | "asyncapi" | "postman" | "preset" | "llm")[];
        status: "suggested" | "accepted" | "edited" | "rejected" | "defaulted" | "conflicted";
        /** Suggested value; any JSON type. */
        value: unknown;
      })[];
    }) | null;
    run_id: string;
    status: "queued" | "analyzing" | "awaiting_confirmation" | "creating_project" | "generating_scenario" | "completed" | "failed";
    step_label: string | null;
  };
  type: "project-setup:snapshot";
};
export type ProjectSetupSnapshotBody = ProjectSetupSnapshot["payload"];

/** On every analysis step, at analysis end and at project creation start. */
export type ProjectSetupProgress = {
  payload: {
    /** `queued`, an analysis graph node name, `analysis_complete` or `create_project`. */
    current_step: string;
    phase: "analyzing" | "analysis_complete" | "creating_project";
    progress: number;
    status: "analyzing" | "awaiting_confirmation" | "creating_project";
    /** Human-readable step. */
    step_label: string;
  };
  type: "project-setup:progress";
};
export type ProjectSetupProgressBody = ProjectSetupProgress["payload"];

/** On each user-visible log line. */
export type ProjectSetupLog = {
  payload: {
    level: "info";
    message: string;
    run_id: string;
    /** UTC ISO 8601, set at send. */
    timestamp: string;
  };
  type: "project-setup:log";
};
export type ProjectSetupLogBody = ProjectSetupLog["payload"];

/** When analysis succeeds, before `analysis_complete`. */
export type ProjectSetupReadiness = {
  payload: {
    can_create_project: boolean;
    can_generate_scenario: boolean;
    completeness_pct: number;
    /** Inputs missing for scenario generation. */
    missing_for_generation: string[];
    /** Fields required to create the project. */
    missing_required: string[];
  };
  type: "project-setup:readiness";
};
export type ProjectSetupReadinessBody = ProjectSetupReadiness["payload"];

/** When analysis succeeds; the run awaits confirmation. */
export type ProjectSetupAnalysisComplete = {
  /** Analysis result. */
  payload: {
    analysis_summary: {
      parse_duration_ms: number;
      sources_parsed: string[];
      warnings: string[];
    };
    /** Draft application description; free-form object. */
    application_description_draft: Record<string, unknown> | null;
    detected_modules: ({
      /** Lower-case path prefix, e.g. `/api/orders`; `/` for root. */
      api_prefix: string;
      confidence: number;
      description: string | null;
      endpoint_count: number;
      name: string | null;
      /** API map part key; null for HAR/LLM modules. */
      part_key: string | null;
      source_kinds: ("user" | "har" | "openapi" | "asyncapi" | "postman" | "preset" | "llm")[];
    })[];
    /** Draft project profile; free-form object. */
    project_profile_draft: Record<string, unknown> | null;
    /** Project-level summary from the LLM. */
    project_summary: string | null;
    readiness: {
      can_create_project: boolean;
      can_generate_scenario: boolean;
      completeness_pct: number;
      /** Inputs missing for scenario generation. */
      missing_for_generation: string[];
      /** Fields required to create the project. */
      missing_required: string[];
    };
    suggested_headers: ({
      name: string;
      source: "user" | "har" | "openapi" | "asyncapi" | "postman" | "preset" | "llm";
      value: string;
    })[];
    suggestions: ({
      confidence: number;
      evidence_refs: string[] | null;
      /** snake_case dotted path, e.g. `project_profile.base_url`. */
      field_path: string;
      rationale: string | null;
      source_kinds: ("user" | "har" | "openapi" | "asyncapi" | "postman" | "preset" | "llm")[];
      status: "suggested" | "accepted" | "edited" | "rejected" | "defaulted" | "conflicted";
      /** Suggested value; any JSON type. */
      value: unknown;
    })[];
  };
  type: "project-setup:analysis_complete";
};
export type ProjectSetupAnalysisCompleteBody = ProjectSetupAnalysisComplete["payload"];

/** When the project row and its specs are stored. */
export type ProjectSetupProjectCreated = {
  payload: {
    /** Specs persisted with the project; empty for a project-scoped run. */
    openapi_spec_ids: string[];
    project_id: string;
  };
  type: "project-setup:project_created";
};
export type ProjectSetupProjectCreatedBody = ProjectSetupProjectCreated["payload"];

/** When the run completes after project creation; the socket stays open. */
export type ProjectSetupComplete = {
  payload: {
    /** Specs persisted with the project; empty for a project-scoped run. */
    openapi_spec_ids: string[];
    project_id: string;
  };
  type: "project-setup:complete";
};
export type ProjectSetupCompleteBody = ProjectSetupComplete["payload"];

/** When analysis, spec persistence or project creation fails; the socket stays open. */
export type ProjectSetupError = {
  payload: {
    /** User-facing cause. */
    error: string;
    phase: "analysis_failed" | "persist_failed" | "create_and_generate_failed";
    /** Rerunning may succeed. */
    recoverable: boolean;
    run_id: string;
    /** UTC ISO 8601, set at send. */
    timestamp: string;
  };
  type: "project-setup:error";
};
export type ProjectSetupErrorBody = ProjectSetupError["payload"];

/** Reply to `project-setup:ping`. */
export type ProjectSetupPong = {
  payload: {
    /** UTC ISO 8601, set at send. */
    timestamp: string;
  };
  type: "project-setup:pong";
};
export type ProjectSetupPongBody = ProjectSetupPong["payload"];

/** Client keep-alive; other JSON frames are ignored. */
export type ProjectSetupPing = {
  type: "project-setup:ping";
};
export type ProjectSetupPingBody = Omit<ProjectSetupPing, "type">;

/** Progress of one project setup run: analysis, then project creation. No credentials are presented. On connect sends `project-setup:connected`, then `project-setup:snapshot` when the run exists; every frame is `{type, payload}`. */
export type ProjectSetupServerFrame = ProjectSetupConnected | ProjectSetupSnapshot | ProjectSetupProgress | ProjectSetupLog | ProjectSetupReadiness | ProjectSetupAnalysisComplete | ProjectSetupProjectCreated | ProjectSetupComplete | ProjectSetupError | ProjectSetupPong;

export type ProjectSetupClientFrame = ProjectSetupPing;

// ---- refine: /ws/flow-suggestions-refine/{job_id}

/** Job running: on connect, and on each step change, ended unit or ~1 s beat. */
export type RefineProgress = {
  payload: {
    /** start: no report yet; group: linking API parts into journeys; describe: writing journeys. */
    current_step: "start" | "group" | "describe";
    /** Units ended in the current step; null at start. */
    described: number | null;
    /** Time the current step has run. Absent at start. */
    elapsed_seconds?: number;
    /** Job was started with force (fresh refinement, no cached units). */
    forced: boolean;
    job_id: string;
    /** Final counts of the group step. Only in describe frames. */
    linked?: {
      described?: number;
      elapsed_seconds?: number;
      total?: number;
    } | null;
    /** Percent: 0 at start, 5-20 in group, 20-95 in describe. */
    progress: number;
    status: "running";
    /** Human-readable step with count, e.g. 'Writing journeys (6 of 12)'. */
    step_label: string;
    /** Model stream chunks received so far. */
    streamed_chunks: number;
    /** Units in the current step; null at start. */
    total: number | null;
  };
  type: "flow-suggestions-refine:progress";
};
export type RefineProgressBody = RefineProgress["payload"];

/** Refinement finished and cached; also the first frame for a finished job (kept 10 min). */
export type RefineComplete = {
  payload: {
    job_id: string;
    /** The refined answer, same shape as the refine HTTP response. */
    result: {
      baskets: ({
        basket_id: string;
        /** API-map area prefixes the chain spans. */
        chain_areas: string[];
        /** Journey-slice chain this basket is a rung of. */
        chain_key: string | null;
        confidence: number;
        /** Editable flow description for the generator; max 32000 chars. */
        description: string;
        /** OpenAPI endpoint ids. */
        endpoint_ids: string[];
        name: string;
        /** e.g. crud, async_polling, tag_group, semantic, auth_rejection, journey_slice; not a closed set. */
        pattern_type: string;
        reasoning: string | null;
        tags: string[];
      })[];
      /** When the result was stored. */
      cached_at: string;
      from_cache: false;
      /** Always null here. */
      job_id: string | null;
      joined: false;
      /** Journey-slice rungs left out by the limit. */
      omitted_journey_slices: ({
        chain_areas?: string[];
        chain_key?: string | null;
        last_endpoint_id?: string;
        name?: string;
        /** Rung = first N chain steps. */
        step_count?: number;
      })[];
      /** Spec hash the cache is keyed on. */
      openapi_hash: string;
      total_endpoints_covered: number;
      uncovered_endpoint_ids: string[];
      /** Refinement units and how each ended. */
      units: ({
        area?: string;
        /** Stable key; usable as retry_unit. */
        key?: string;
        kind?: "area" | "path" | "part";
        name?: string;
        operation_count?: number;
        /** Why it failed or split. */
        reason?: string | null;
        /** answer_refused, answer_unusable, prompt_over_budget, not_run, catalogue_over_budget, or a provider failure code. */
        reason_code?: string | null;
        /** Rerunning the unit may succeed. */
        recoverable?: boolean;
        status?: "ready" | "done" | "cached" | "failed" | "split";
      })[];
    };
    status: "complete";
  };
  type: "flow-suggestions-refine:complete";
};
export type RefineCompleteBody = RefineComplete["payload"];

/** Job failed, or the job id is unknown (then the socket closes with 4404). */
export type RefineError = {
  payload: {
    /** User-facing failure message. */
    error: string;
    job_id: string;
    /** job_not_found for an unknown job (socket then closed with 4404); null for a failed job. */
    reason: string | null;
    /** Starting the refinement again may succeed. */
    recoverable: boolean;
    status: "failed";
  };
  type: "flow-suggestions-refine:error";
};
export type RefineErrorBody = RefineError["payload"];

/** Job cancelled (cancel endpoint, or no socket watched it for 45 s). */
export type RefineCancelled = {
  payload: {
    job_id: string;
    status: "cancelled";
  };
  type: "flow-suggestions-refine:cancelled";
};
export type RefineCancelledBody = RefineCancelled["payload"];

/** Progress and outcome of a background refinement started by POST /api/v1/projects/{project_id}/flow-suggestions/refine. The first frame is the job's current state (last progress, or its outcome); an unknown job gets an error frame and close 4404. The server does not close after an outcome frame. No credentials are presented. */
export type RefineServerFrame = RefineProgress | RefineComplete | RefineError | RefineCancelled;

export type RefineClientFrame = never;

// ---- scenario: /ws/gatling-scenario/{run_id}

/** A pipeline node (generation) or deterministic stage (regeneration) started; once more when plan_scenario reports its planner path. */
export type GatlingScenarioProgress = {
  payload: {
    /** Generation nodes, or regeneration stages (resolving..persisting). */
    current_step: "validate_input" | "enrich_context" | "resolve_test_type" | "plan_scenario" | "generate_feeder_data" | "generate_skeleton" | "validate_compilation" | "finalize" | "resolving" | "materializing" | "feeders" | "compiling" | "persisting";
    /** Only in the plan_scenario end frame: how the plan was made (slo_planner = model call). */
    planner_path?: "deterministic_no_recorded_times" | "deterministic_no_llm" | "slo_planner";
    /** Only with planner_path: why that path was taken. */
    planner_path_reason?: string;
    /** Percent. Generation: node index / 8 * 100; regeneration: 10, 30, 55, 80, 95. */
    progress: number;
    status: "in_progress";
    /** Human-readable step, e.g. 'Generating Scala code...'. */
    step_label: string;
  };
  type: "gatling-scenario:progress";
};
export type GatlingScenarioProgressBody = GatlingScenarioProgress["payload"];

/** Scenario persisted (its self-check already scheduled); replayed to a late socket. */
export type GatlingScenarioComplete = {
  payload: {
    run_id: string;
    /** Created (generation) or updated (regeneration) scenario. */
    scenario_id: string;
    status: "completed";
  };
  type: "gatling-scenario:complete";
};
export type GatlingScenarioCompleteBody = GatlingScenarioComplete["payload"];

/** Run failed or was refused; nothing persisted. Replayed to a late socket. */
export type GatlingScenarioError = {
  payload: {
    /** User-facing failure message. */
    error: string;
    /** Retrying the same request may succeed. */
    recoverable: boolean;
    /** HTTP-style status of the failure (e.g. 400, 404, 409, 422, 500). Always on regeneration errors; on generation only for 422 refusals. */
    status_code?: number;
  };
  type: "gatling-scenario:error";
};
export type GatlingScenarioErrorBody = GatlingScenarioError["payload"];

/** Run cancelled via its cancel endpoint before persisting; replayed to a late socket. */
export type GatlingScenarioCancelled = {
  payload: {
    run_id: string;
    status: "cancelled";
  };
  type: "gatling-scenario:cancelled";
};
export type GatlingScenarioCancelledBody = GatlingScenarioCancelled["payload"];

/** Progress and outcome of an async scenario generation or regeneration. Progress is sent only to sockets connected at the time; a socket connecting after the run ended first receives the cached outcome frame (handed to one connect only). The server never closes the socket. No credentials are presented. */
export type ScenarioServerFrame = GatlingScenarioProgress | GatlingScenarioComplete | GatlingScenarioError | GatlingScenarioCancelled;

export type ScenarioClientFrame = never;

// ---- testTypes: /ws/test-types/{run_id}

/** A step of the AI run started or finished (15, 55, then 100 percent). */
export type TestTypesProgress = {
  payload: {
    current_step: "prepare_context" | "run_operation";
    mode: "suggest" | "generate";
    progress: number;
    /** Also at 100 percent. */
    status: "in_progress";
    /** Human-readable step. */
    step_label: string;
  };
  type: "test-types:progress";
};
export type TestTypesProgressBody = TestTypesProgress["payload"];

/** The run finished; carries its result (fields depend on mode). */
export type TestTypesComplete = {
  payload: {
    /** mode generate only: test types created. */
    created?: number;
    mode: "suggest" | "generate";
    /** Operations (METHOD path) of a large API not shown to the model; empty when all were. */
    omitted_operations: string[];
    /** mode generate only: the model's reasoning. */
    rationale?: string | null;
    run_id: string;
    /** mode generate only: base types already in the project. */
    skipped?: number;
    /** mode generate only: body path of the soft-error status. */
    soft_error_status_path?: string | null;
    status: "completed";
    /** mode suggest only: suggested test types (not saved). */
    suggestions?: ({
      /** e.g. functional, security, performance, data_quality, domain_specific. */
      category: string;
      description: string;
      display_name: string;
      example_inputs: Record<string, unknown>[];
      /** success, blocked, fail, error; null when unknown. */
      expected_outcome: string | null;
      /** Prompt template for generating test inputs. */
      input_generation_prompt: string;
      /** snake_case identifier. */
      name: string;
      rationale: string;
    })[];
    /** mode generate only: created project test types. */
    test_types?: ({
      base_type: ({
        category: string;
        description: string;
        display_name: string;
        example_inputs: Record<string, unknown>[];
        expected_outcome: string | null;
        id: string;
        input_generation_prompt: string;
        is_active: boolean;
        is_builtin: boolean;
        name: string;
      }) | null;
      base_type_display_name: string | null;
      base_type_expected_outcome: string | null;
      base_type_id: string | null;
      base_type_name: string | null;
      custom_category: string | null;
      custom_description: string | null;
      custom_display_name: string | null;
      custom_example_inputs: Record<string, unknown>[] | null;
      custom_expected_outcome: string | null;
      custom_input_prompt: string | null;
      custom_name: string | null;
      default_count: number;
      effective_category: string | null;
      effective_display_name: string;
      effective_expected_outcome: string | null;
      /** Custom name, else base name. */
      effective_name: string;
      id: string;
      is_enabled: boolean;
      /** Statuses that end an async operation. */
      poll_completion_values: string[] | null;
      poll_timeout_ms: number | null;
      priority: number;
      project_id: string;
    })[];
    /** mode suggest only: number of suggestions. */
    total?: number;
    /** mode generate only: API reports errors in HTTP 200 bodies. */
    uses_soft_errors?: boolean;
  };
  type: "test-types:complete";
};
export type TestTypesCompleteBody = TestTypesComplete["payload"];

/** The run failed. */
export type TestTypesError = {
  payload: {
    /** User-facing failure. */
    error: string;
    mode: "suggest" | "generate";
    /** Running again may succeed. */
    recoverable: boolean;
  };
  type: "test-types:error";
};
export type TestTypesErrorBody = TestTypesError["payload"];

/** Live progress of an AI test type run started by POST /api/v1/projects/{project_id}/test-types/suggest-async or generate-async. Nothing is replayed on connect; frames sent before the socket joined are lost (GET .../test-types/suggest/{run_id} holds the outcome). No credentials are presented. */
export type TestTypesServerFrame = TestTypesProgress | TestTypesComplete | TestTypesError;

export type TestTypesClientFrame = never;

/** Frames the server sends, by channel and wire type: the whole frame and the keys it carries. */
export interface ServerFrames {
  analysis: {
    "gatling-analysis:progress": { frame: GatlingAnalysisProgress; body: GatlingAnalysisProgressBody };
    "gatling-analysis:complete": { frame: GatlingAnalysisComplete; body: GatlingAnalysisCompleteBody };
    "gatling-analysis:error": { frame: GatlingAnalysisError; body: GatlingAnalysisErrorBody };
  };
  batch: {
    "batch-generation:basket-progress": { frame: BatchBasketProgress; body: BatchBasketProgressBody };
    "batch-generation:basket-complete": { frame: BatchBasketComplete; body: BatchBasketCompleteBody };
    "batch-generation:basket-error": { frame: BatchBasketError; body: BatchBasketErrorBody };
    "batch-generation:complete": { frame: BatchComplete; body: BatchCompleteBody };
    "batch-generation:error": { frame: BatchError; body: BatchErrorBody };
  };
  describe: {
    "progress": { frame: DescribeProgress; body: DescribeProgressBody };
    "path_done": { frame: DescribePathDone; body: DescribePathDoneBody };
    "path_failed": { frame: DescribePathFailed; body: DescribePathFailedBody };
    "path_stage": { frame: DescribePathStage; body: DescribePathStageBody };
    "split_proposal": { frame: DescribeSplitProposal; body: DescribeSplitProposalBody };
    "split_resume_refused": { frame: DescribeSplitResumeRefused; body: DescribeSplitResumeRefusedBody };
    "drive_snapshot": { frame: DescribeDriveSnapshot; body: DescribeDriveSnapshotBody };
    "complete": { frame: DescribeComplete; body: DescribeCompleteBody };
    "error": { frame: DescribeError; body: DescribeErrorBody };
    "cancelled": { frame: DescribeCancelled; body: DescribeCancelledBody };
    "interrupted": { frame: DescribeInterrupted; body: DescribeInterruptedBody };
    "agent_step": { frame: DescribeAgentStep; body: DescribeAgentStepBody };
    "agent_plan": { frame: DescribeAgentPlan; body: DescribeAgentPlanBody };
    "hint_accepted": { frame: DescribeHintAccepted; body: DescribeHintAcceptedBody };
    "hint_refused": { frame: DescribeHintRefused; body: DescribeHintRefusedBody };
    "hint_read": { frame: DescribeHintRead; body: DescribeHintReadBody };
    "hint_not_read": { frame: DescribeHintNotRead; body: DescribeHintNotReadBody };
    "stop_accepted": { frame: DescribeStopAccepted; body: DescribeStopAcceptedBody };
    "stop_refused": { frame: DescribeStopRefused; body: DescribeStopRefusedBody };
    "redrive_started": { frame: DescribeRedriveStarted; body: DescribeRedriveStartedBody };
    "redrive_diverged": { frame: DescribeRedriveDiverged; body: DescribeRedriveDivergedBody };
    "redrive_continued": { frame: DescribeRedriveContinued; body: DescribeRedriveContinuedBody };
    "redrive_operator_part": { frame: DescribeRedriveOperatorPart; body: DescribeRedriveOperatorPartBody };
    "redrive_cancelled": { frame: DescribeRedriveCancelled; body: DescribeRedriveCancelledBody };
    "redrive_result": { frame: DescribeRedriveResult; body: DescribeRedriveResultBody };
    "replay_continue_refused": { frame: DescribeReplayContinueRefused; body: DescribeReplayContinueRefusedBody };
    "help_requested": { frame: DescribeHelpRequested; body: DescribeHelpRequestedBody };
    "control_taken": { frame: DescribeControlTaken; body: DescribeControlTakenBody };
    "control_returned": { frame: DescribeControlReturned; body: DescribeControlReturnedBody };
    "message_denied": { frame: DescribeMessageDenied; body: DescribeMessageDeniedBody };
  };
  execution: {
    "execution:api_request": { frame: ExecutionApiRequest; body: ExecutionApiRequestBody };
    "api_request": { frame: ExecutionApiRequestLegacy; body: ExecutionApiRequestLegacyBody };
    "execution:api_response": { frame: ExecutionApiResponse; body: ExecutionApiResponseBody };
    "api_response": { frame: ExecutionApiResponseLegacy; body: ExecutionApiResponseLegacyBody };
    "execution:execution_complete": { frame: ExecutionComplete; body: ExecutionCompleteBody };
    "execution_complete": { frame: ExecutionCompleteLegacy; body: ExecutionCompleteLegacyBody };
    "heartbeat": { frame: ExecutionHeartbeat; body: ExecutionHeartbeatBody };
  };
  flowGeneration: {
    "flow-generation:progress": { frame: FlowGenerationProgress; body: FlowGenerationProgressBody };
    "flow-generation:complete": { frame: FlowGenerationComplete; body: FlowGenerationCompleteBody };
    "flow-generation:error": { frame: FlowGenerationError; body: FlowGenerationErrorBody };
    "flow-generation:cancelled": { frame: FlowGenerationCancelled; body: FlowGenerationCancelledBody };
  };
  gatlingExecution: {
    "gatling:status_update": { frame: GatlingExecutionStatusUpdate; body: GatlingExecutionStatusUpdateBody };
    "status_update": { frame: GatlingExecutionLegacyStatusUpdate; body: GatlingExecutionLegacyStatusUpdateBody };
    "gatling:log": { frame: GatlingExecutionLog; body: GatlingExecutionLogBody };
    "log": { frame: GatlingExecutionLegacyLog; body: GatlingExecutionLegacyLogBody };
    "gatling:execution_complete": { frame: GatlingExecutionComplete; body: GatlingExecutionCompleteBody };
    "execution_complete": { frame: GatlingExecutionLegacyComplete; body: GatlingExecutionLegacyCompleteBody };
    "heartbeat": { frame: GatlingExecutionHeartbeat; body: GatlingExecutionHeartbeatBody };
    "live_metrics": { frame: GatlingLiveMetrics; body: GatlingLiveMetricsBody };
    "live_per_request": { frame: GatlingLivePerRequest; body: GatlingLivePerRequestBody };
    "live_error": { frame: GatlingLiveError; body: GatlingLiveErrorBody };
  };
  gatlingExecutionLive: {
    "gatling:status_update": { frame: GatlingExecutionStatusUpdate; body: GatlingExecutionStatusUpdateBody };
    "status_update": { frame: GatlingExecutionLegacyStatusUpdate; body: GatlingExecutionLegacyStatusUpdateBody };
    "gatling:log": { frame: GatlingExecutionLog; body: GatlingExecutionLogBody };
    "log": { frame: GatlingExecutionLegacyLog; body: GatlingExecutionLegacyLogBody };
    "gatling:execution_complete": { frame: GatlingExecutionComplete; body: GatlingExecutionCompleteBody };
    "execution_complete": { frame: GatlingExecutionLegacyComplete; body: GatlingExecutionLegacyCompleteBody };
    "heartbeat": { frame: GatlingExecutionHeartbeat; body: GatlingExecutionHeartbeatBody };
    "live_metrics": { frame: GatlingLiveMetrics; body: GatlingLiveMetricsBody };
    "live_per_request": { frame: GatlingLivePerRequest; body: GatlingLivePerRequestBody };
    "live_error": { frame: GatlingLiveError; body: GatlingLiveErrorBody };
  };
  gatlingFeeder: {
    "gatling-feeder:progress": { frame: GatlingFeederProgress; body: GatlingFeederProgressBody };
    "gatling-feeder:complete": { frame: GatlingFeederComplete; body: GatlingFeederCompleteBody };
    "gatling-feeder:error": { frame: GatlingFeederError; body: GatlingFeederErrorBody };
    "feeder.source_decided": { frame: GatlingFeederSourceDecided; body: GatlingFeederSourceDecidedBody };
    "feeder.recipe_received": { frame: GatlingFeederRecipeReceived; body: GatlingFeederRecipeReceivedBody };
    "feeder.budget_fallback": { frame: GatlingFeederBudgetFallback; body: GatlingFeederBudgetFallbackBody };
    "feeder.validation_failed": { frame: GatlingFeederValidationFailed; body: GatlingFeederValidationFailedBody };
  };
  har: {
    "har:progress": { frame: HarProgress; body: HarProgressBody };
    "har:complete": { frame: HarComplete; body: HarCompleteBody };
    "har:error": { frame: HarError; body: HarErrorBody };
    "har:cancelled": { frame: HarCancelled; body: HarCancelledBody };
    "split_proposal": { frame: HarSplitProposal; body: HarSplitProposalBody };
  };
  healthCheck: {
    "progress": { frame: HealthCheckProgress; body: HealthCheckProgressBody };
    "complete": { frame: HealthCheckComplete; body: HealthCheckCompleteBody };
    "error": { frame: HealthCheckError; body: HealthCheckErrorBody };
    "cancelled": { frame: HealthCheckCancelled; body: HealthCheckCancelledBody };
  };
  liveView: {
    "no_browser": { frame: LiveViewNoBrowser; body: LiveViewNoBrowserBody };
    "opening": { frame: LiveViewOpening; body: LiveViewOpeningBody };
    "live": { frame: LiveViewLive; body: LiveViewLiveBody };
    "blocked": { frame: LiveViewBlocked; body: LiveViewBlockedBody };
    "blank_page": { frame: LiveViewBlankPage; body: LiveViewBlankPageBody };
    "invalid_watch": { frame: LiveViewInvalidWatch; body: LiveViewInvalidWatchBody };
    "take_refused": { frame: LiveViewTakeRefused; body: LiveViewTakeRefusedBody };
    "lease_refused": { frame: LiveViewLeaseRefused; body: LiveViewLeaseRefusedBody };
    "control_granted": { frame: LiveViewControlGranted; body: LiveViewControlGrantedBody };
    "control_ended": { frame: LiveViewControlEnded; body: LiveViewControlEndedBody };
    "control_idle": { frame: LiveViewControlIdle; body: LiveViewControlIdleBody };
    "input_refused": { frame: LiveViewInputRefused; body: LiveViewInputRefusedBody };
    "navigation_refused": { frame: LiveViewNavigationRefused; body: LiveViewNavigationRefusedBody };
    "select_options": { frame: LiveViewSelectOptions; body: LiveViewSelectOptionsBody };
    "file_requested": { frame: LiveViewFileRequested; body: LiveViewFileRequestedBody };
    "file_refused": { frame: LiveViewFileRefused; body: LiveViewFileRefusedBody };
    "file_sent": { frame: LiveViewFileSent; body: LiveViewFileSentBody };
    "page_dialog": { frame: LiveViewPageDialog; body: LiveViewPageDialogBody };
    "page_dialog_closed": { frame: LiveViewPageDialogClosed; body: LiveViewPageDialogClosedBody };
    "message_denied": { frame: LiveViewMessageDenied; body: LiveViewMessageDeniedBody };
  };
  payloadGen: {
    "payload-gen:progress": { frame: PayloadGenProgress; body: PayloadGenProgressBody };
    "payload-gen:complete": { frame: PayloadGenComplete; body: PayloadGenCompleteBody };
    "payload-gen:error": { frame: PayloadGenError; body: PayloadGenErrorBody };
  };
  projectExecution: {
    "heartbeat": { frame: ProjectExecutionHeartbeat; body: ProjectExecutionHeartbeatBody };
  };
  projectSetup: {
    "project-setup:connected": { frame: ProjectSetupConnected; body: ProjectSetupConnectedBody };
    "project-setup:snapshot": { frame: ProjectSetupSnapshot; body: ProjectSetupSnapshotBody };
    "project-setup:progress": { frame: ProjectSetupProgress; body: ProjectSetupProgressBody };
    "project-setup:log": { frame: ProjectSetupLog; body: ProjectSetupLogBody };
    "project-setup:readiness": { frame: ProjectSetupReadiness; body: ProjectSetupReadinessBody };
    "project-setup:analysis_complete": { frame: ProjectSetupAnalysisComplete; body: ProjectSetupAnalysisCompleteBody };
    "project-setup:project_created": { frame: ProjectSetupProjectCreated; body: ProjectSetupProjectCreatedBody };
    "project-setup:complete": { frame: ProjectSetupComplete; body: ProjectSetupCompleteBody };
    "project-setup:error": { frame: ProjectSetupError; body: ProjectSetupErrorBody };
    "project-setup:pong": { frame: ProjectSetupPong; body: ProjectSetupPongBody };
  };
  refine: {
    "flow-suggestions-refine:progress": { frame: RefineProgress; body: RefineProgressBody };
    "flow-suggestions-refine:complete": { frame: RefineComplete; body: RefineCompleteBody };
    "flow-suggestions-refine:error": { frame: RefineError; body: RefineErrorBody };
    "flow-suggestions-refine:cancelled": { frame: RefineCancelled; body: RefineCancelledBody };
  };
  scenario: {
    "gatling-scenario:progress": { frame: GatlingScenarioProgress; body: GatlingScenarioProgressBody };
    "gatling-scenario:complete": { frame: GatlingScenarioComplete; body: GatlingScenarioCompleteBody };
    "gatling-scenario:error": { frame: GatlingScenarioError; body: GatlingScenarioErrorBody };
    "gatling-scenario:cancelled": { frame: GatlingScenarioCancelled; body: GatlingScenarioCancelledBody };
  };
  testTypes: {
    "test-types:progress": { frame: TestTypesProgress; body: TestTypesProgressBody };
    "test-types:complete": { frame: TestTypesComplete; body: TestTypesCompleteBody };
    "test-types:error": { frame: TestTypesError; body: TestTypesErrorBody };
  };
}

/** Frames the server receives, by channel and wire type. */
export interface ClientFrames {
  analysis: {
  };
  batch: {
  };
  describe: {
    "stop": { frame: DescribeStop; body: DescribeStopBody };
    "hint": { frame: DescribeHint; body: DescribeHintBody };
    "cancel": { frame: DescribeCancel; body: DescribeCancelBody };
    "replay_continue": { frame: DescribeReplayContinue; body: DescribeReplayContinueBody };
    "split_resume": { frame: DescribeSplitResume; body: DescribeSplitResumeBody };
  };
  execution: {
  };
  flowGeneration: {
    "flow-generation:cancel": { frame: FlowGenerationCancel; body: FlowGenerationCancelBody };
  };
  gatlingExecution: {
  };
  gatlingExecutionLive: {
  };
  gatlingFeeder: {
  };
  har: {
    "har:upload": { frame: HarUpload; body: HarUploadBody };
    "har:analyze": { frame: HarAnalyze; body: HarAnalyzeBody };
    "har:generate": { frame: HarGenerate; body: HarGenerateBody };
    "har:cancel": { frame: HarCancel; body: HarCancelBody };
    "split_resume": { frame: HarSplitResume; body: HarSplitResumeBody };
  };
  healthCheck: {
    "cancel": { frame: HealthCheckCancel; body: HealthCheckCancelBody };
  };
  liveView: {
    "watch": { frame: LiveViewWatch; body: LiveViewWatchBody };
    "take_control": { frame: LiveViewTakeControl; body: LiveViewTakeControlBody };
    "claim_control": { frame: LiveViewClaimControl; body: LiveViewClaimControlBody };
    "hand_back": { frame: LiveViewHandBack; body: LiveViewHandBackBody };
    "input": { frame: LiveViewInput; body: LiveViewInputBody };
    "navigate": { frame: LiveViewNavigate; body: LiveViewNavigateBody };
    "choose_option": { frame: LiveViewChooseOption; body: LiveViewChooseOptionBody };
    "send_file": { frame: LiveViewSendFile; body: LiveViewSendFileBody };
    "answer_dialog": { frame: LiveViewAnswerDialog; body: LiveViewAnswerDialogBody };
  };
  payloadGen: {
  };
  projectExecution: {
  };
  projectSetup: {
    "project-setup:ping": { frame: ProjectSetupPing; body: ProjectSetupPingBody };
  };
  refine: {
  };
  scenario: {
  };
  testTypes: {
  };
}

/** The keys of a server frame: the `payload` of an enveloped frame, the frame without `type` otherwise. */
export type ServerBody<C extends keyof ServerFrames, T extends keyof ServerFrames[C]> =
  ServerFrames[C][T] extends { body: infer B } ? B : never;

/** The keys of a client frame, as `ServerBody` for the server's. */
export type ClientBody<C extends keyof ClientFrames, T extends keyof ClientFrames[C]> =
  ClientFrames[C][T] extends { body: infer B } ? B : never;

/** What a channel's metadata must satisfy: a terminal frame is a frame the channel sends. */
export type ChannelMetadata = {
  [C in keyof ServerFrames]: {
    readonly terminalFrames: readonly (keyof ServerFrames[C])[];
    readonly [extra: string]: unknown;
  };
};

/** Address, path parameters and wire types of every channel; `terminalFrames` are the server frames that end a run, `replay` what a socket sends on connect, `closeCodes` what the server's close codes mean, `requiresOrigin` whether the handshake needs an `Origin` header, `startedBy` the REST operations that start a run and the field that returns the channel parameter; `rawServer` and `rawClient` list the text and binary messages. */
export const CHANNELS = {
  analysis: {
    address: "/ws/gatling-analysis/{run_id}",
    params: ["run_id"],
    security: [],
    serverTypes: ["gatling-analysis:progress", "gatling-analysis:complete", "gatling-analysis:error"],
    clientTypes: [],
    terminalFrames: ["gatling-analysis:complete", "gatling-analysis:error"],
    replay: {"mode":"none"},
    closeCodes: {},
    requiresOrigin: false,
    startedBy: [{"field":"run_id","operationId":"analyze_execution_async_api_v1_projects__project_id__gatling_executions__execution_id__analyze_async_post","parameter":"run_id","source":"response"}],
    envelopes: { "gatling-analysis:progress": "payload", "gatling-analysis:complete": "payload", "gatling-analysis:error": "payload" },
    rawServer: [],
    rawClient: [],
  },
  batch: {
    address: "/ws/batch-generation/{run_id}",
    params: ["run_id"],
    security: [],
    serverTypes: ["batch-generation:basket-progress", "batch-generation:basket-complete", "batch-generation:basket-error", "batch-generation:complete", "batch-generation:error"],
    clientTypes: [],
    terminalFrames: ["batch-generation:complete", "batch-generation:error"],
    replay: {"mode":"events"},
    closeCodes: {"4404":"Unknown run (server restarted or run expired); sent after accept, right after a BatchError with reason run_not_found."},
    requiresOrigin: false,
    startedBy: [{"field":"run_id","operationId":"batch_generate_flows_api_v1_projects__project_id__flow_suggestions_batch_generate_post","parameter":"run_id","source":"response"}],
    envelopes: { "batch-generation:basket-progress": "payload", "batch-generation:basket-complete": "payload", "batch-generation:basket-error": "payload", "batch-generation:complete": "payload", "batch-generation:error": "payload" },
    rawServer: [],
    rawClient: [],
  },
  describe: {
    address: "/ws/projects/{project_id}/scenario-from-description/runs/{run_id}",
    params: ["project_id", "run_id"],
    security: ["bearerToken", "sessionCookie"],
    serverTypes: ["progress", "path_done", "path_failed", "path_stage", "split_proposal", "split_resume_refused", "drive_snapshot", "complete", "error", "cancelled", "interrupted", "agent_step", "agent_plan", "hint_accepted", "hint_refused", "hint_read", "hint_not_read", "stop_accepted", "stop_refused", "redrive_started", "redrive_diverged", "redrive_continued", "redrive_operator_part", "redrive_cancelled", "redrive_result", "replay_continue_refused", "help_requested", "control_taken", "control_returned", "message_denied"],
    clientTypes: ["stop", "hint", "cancel", "replay_continue", "split_resume"],
    terminalFrames: ["complete", "error", "cancelled", "interrupted"],
    replay: {"mode":"state"},
    closeCodes: {"4001":"Handshake: no or invalid credentials, or an API token in ?token=.","4003":"Handshake: Origin missing or not same-origin, or no viewer access to the project. After accept: follows message_denied project_access_denied.","4404":"Handshake: run not found or not owned. After accept: follows message_denied run_not_found."},
    requiresOrigin: true,
    startedBy: [{"field":"run_id","operationId":"generate_scenario_api_v1_projects__project_id__scenario_from_description_generate_post","parameter":"run_id","source":"response"}],
    envelopes: { "progress": "flat", "path_done": "flat", "path_failed": "flat", "path_stage": "flat", "split_proposal": "flat", "split_resume_refused": "flat", "drive_snapshot": "flat", "complete": "flat", "error": "flat", "cancelled": "flat", "interrupted": "flat", "agent_step": "flat", "agent_plan": "flat", "hint_accepted": "flat", "hint_refused": "flat", "hint_read": "flat", "hint_not_read": "flat", "stop_accepted": "flat", "stop_refused": "flat", "redrive_started": "flat", "redrive_diverged": "flat", "redrive_continued": "flat", "redrive_operator_part": "flat", "redrive_cancelled": "flat", "redrive_result": "flat", "replay_continue_refused": "flat", "help_requested": "flat", "control_taken": "flat", "control_returned": "flat", "message_denied": "flat", "stop": "flat", "hint": "flat", "cancel": "flat", "replay_continue": "flat", "split_resume": "flat" },
    rawServer: [],
    rawClient: [],
  },
  execution: {
    address: "/ws/executions/{run_id}",
    params: ["run_id"],
    security: [],
    serverTypes: ["execution:api_request", "api_request", "execution:api_response", "api_response", "execution:execution_complete", "execution_complete", "heartbeat"],
    clientTypes: [],
    terminalFrames: ["execution:execution_complete", "execution_complete"],
    replay: {"mode":"none"},
    closeCodes: {},
    requiresOrigin: false,
    startedBy: [{"field":"execution_id","operationId":"execute_adhoc_api_v1_projects__project_id__execute_post","parameter":"run_id","source":"response"},{"field":"execution_id","operationId":"retry_execution_api_v1_projects__project_id__executions__execution_id__retry_post","parameter":"run_id","source":"response"}],
    envelopes: { "execution:api_request": "flat", "api_request": "flat", "execution:api_response": "flat", "api_response": "flat", "execution:execution_complete": "flat", "execution_complete": "flat", "heartbeat": "flat" },
    rawServer: [{ key: "ExecutionPong", kind: "text", text: "pong" }],
    rawClient: [{ key: "ExecutionPing", kind: "text", text: "ping" }],
  },
  flowGeneration: {
    address: "/ws/flow-generation/{run_id}",
    params: ["run_id"],
    security: [],
    serverTypes: ["flow-generation:progress", "flow-generation:complete", "flow-generation:error", "flow-generation:cancelled"],
    clientTypes: ["flow-generation:cancel"],
    terminalFrames: ["flow-generation:complete", "flow-generation:error", "flow-generation:cancelled"],
    replay: {"mode":"state"},
    closeCodes: {},
    requiresOrigin: false,
    startedBy: [{"field":"run_id","operationId":"generate_flow_async_api_v1_projects__project_id__flows_generate_async_post","parameter":"run_id","source":"response"},{"field":"run_id","operationId":"regenerate_flow_api_v1_projects__project_id__flows__flow_id__regenerate_post","parameter":"run_id","source":"response"}],
    envelopes: { "flow-generation:progress": "payload", "flow-generation:complete": "payload", "flow-generation:error": "payload", "flow-generation:cancelled": "payload", "flow-generation:cancel": "flat" },
    rawServer: [],
    rawClient: [],
  },
  gatlingExecution: {
    address: "/ws/gatling/executions/{execution_id}",
    params: ["execution_id"],
    security: [],
    serverTypes: ["gatling:status_update", "status_update", "gatling:log", "log", "gatling:execution_complete", "execution_complete", "heartbeat", "live_metrics", "live_per_request", "live_error"],
    clientTypes: [],
    terminalFrames: ["gatling:execution_complete", "execution_complete"],
    replay: {"mode":"none"},
    closeCodes: {"4001":"token missing or shorter than 16 characters","4003":"project_id missing, execution not in that project, or check failed","4404":"execution not found"},
    requiresOrigin: false,
    startedBy: [{"field":"id","operationId":"start_execution_api_v1_projects__project_id__gatling_executions_post","parameter":"execution_id","source":"response"},{"field":"execution_id","operationId":"execute_composition_api_v1_projects__project_id__gatling_compositions__composition_id__execute_post","parameter":"execution_id","source":"response"},{"field":"execution_id","operationId":"execute_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__execute_post","parameter":"execution_id","source":"response"}],
    envelopes: { "gatling:status_update": "flat", "status_update": "flat", "gatling:log": "flat", "log": "flat", "gatling:execution_complete": "flat", "execution_complete": "flat", "heartbeat": "flat", "live_metrics": "flat", "live_per_request": "flat", "live_error": "flat" },
    rawServer: [{ key: "GatlingExecutionPong", kind: "text", text: "pong" }],
    rawClient: [{ key: "GatlingExecutionPing", kind: "text", text: "ping" }],
  },
  gatlingExecutionLive: {
    address: "/ws/gatling/executions/{execution_id}/live",
    params: ["execution_id"],
    security: [],
    serverTypes: ["gatling:status_update", "status_update", "gatling:log", "log", "gatling:execution_complete", "execution_complete", "heartbeat", "live_metrics", "live_per_request", "live_error"],
    clientTypes: [],
    terminalFrames: ["gatling:execution_complete", "execution_complete"],
    replay: {"mode":"none"},
    closeCodes: {"4001":"token missing or shorter than 16 characters","4003":"project_id missing, execution not in that project, or check failed","4404":"execution not found"},
    requiresOrigin: false,
    startedBy: [{"field":"id","operationId":"start_execution_api_v1_projects__project_id__gatling_executions_post","parameter":"execution_id","source":"response"},{"field":"execution_id","operationId":"execute_composition_api_v1_projects__project_id__gatling_compositions__composition_id__execute_post","parameter":"execution_id","source":"response"},{"field":"execution_id","operationId":"execute_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__execute_post","parameter":"execution_id","source":"response"}],
    envelopes: { "gatling:status_update": "flat", "status_update": "flat", "gatling:log": "flat", "log": "flat", "gatling:execution_complete": "flat", "execution_complete": "flat", "heartbeat": "flat", "live_metrics": "flat", "live_per_request": "flat", "live_error": "flat" },
    rawServer: [{ key: "GatlingExecutionPong", kind: "text", text: "pong" }],
    rawClient: [{ key: "GatlingExecutionPing", kind: "text", text: "ping" }],
  },
  gatlingFeeder: {
    address: "/ws/gatling-feeder/{run_id}",
    params: ["run_id"],
    security: [],
    serverTypes: ["gatling-feeder:progress", "gatling-feeder:complete", "gatling-feeder:error", "feeder.source_decided", "feeder.recipe_received", "feeder.budget_fallback", "feeder.validation_failed"],
    clientTypes: [],
    terminalFrames: ["gatling-feeder:complete", "gatling-feeder:error"],
    replay: {"mode":"none"},
    closeCodes: {},
    requiresOrigin: false,
    startedBy: [{"field":"run_id","operationId":"generate_feeder_async_api_v1_projects__project_id__gatling_feeders_generate_async_post","parameter":"run_id","source":"response"},{"field":"run_id","operationId":"regenerate_single_feeder_column_api_v1_projects__project_id__gatling_feeders__feeder_id__regenerate_column_post","parameter":"run_id","source":"request"}],
    envelopes: { "gatling-feeder:progress": "payload", "gatling-feeder:complete": "payload", "gatling-feeder:error": "payload", "feeder.source_decided": "payload", "feeder.recipe_received": "payload", "feeder.budget_fallback": "payload", "feeder.validation_failed": "payload" },
    rawServer: [],
    rawClient: [],
  },
  har: {
    address: "/ws/projects/{project_id}/har/{session_id}",
    params: ["project_id", "session_id"],
    security: ["bearerToken", "sessionCookie"],
    serverTypes: ["har:progress", "har:complete", "har:error", "har:cancelled", "split_proposal"],
    clientTypes: ["har:upload", "har:analyze", "har:generate", "har:cancel", "split_resume"],
    terminalFrames: ["har:complete", "har:error", "har:cancelled"],
    replay: {"mode":"none"},
    closeCodes: {"4001":"No credentials, invalid token or Authorization header, or an API token in ?token= (reason query_token_not_accepted)","4003":"Project access denied: not a member with viewer role, project not found, or API token pinned to another project"},
    requiresOrigin: false,
    startedBy: [{"field":"har_session_id","operationId":"upload_har_api_v1_projects__project_id__har_upload_post","parameter":"session_id","source":"response"}],
    envelopes: { "har:progress": "payload", "har:complete": "payload", "har:error": "payload", "har:cancelled": "payload", "split_proposal": "flat", "har:upload": "flat", "har:analyze": "flat", "har:generate": "flat", "har:cancel": "flat", "split_resume": "flat" },
    rawServer: [],
    rawClient: [],
  },
  healthCheck: {
    address: "/ws/health-check/{session_id}",
    params: ["session_id"],
    security: [],
    serverTypes: ["progress", "complete", "error", "cancelled"],
    clientTypes: ["cancel"],
    terminalFrames: ["complete", "error", "cancelled"],
    replay: {"mode":"none"},
    closeCodes: {},
    requiresOrigin: false,
    startedBy: [{"field":"session_id","operationId":"trigger_health_check_api_scenarios__scenario_id__health_check_post","parameter":"session_id","source":"response"}],
    envelopes: { "progress": "flat", "complete": "flat", "error": "flat", "cancelled": "flat", "cancel": "flat" },
    rawServer: [],
    rawClient: [],
  },
  liveView: {
    address: "/ws/projects/{project_id}/scenario-from-description/runs/{run_id}/live",
    params: ["project_id", "run_id"],
    security: ["sessionCookie"],
    serverTypes: ["no_browser", "opening", "live", "blocked", "blank_page", "invalid_watch", "take_refused", "lease_refused", "control_granted", "control_ended", "control_idle", "input_refused", "navigation_refused", "select_options", "file_requested", "file_refused", "file_sent", "page_dialog", "page_dialog_closed", "message_denied"],
    clientTypes: ["watch", "take_control", "claim_control", "hand_back", "input", "navigate", "choose_option", "send_file", "answer_dialog"],
    terminalFrames: [],
    replay: {"mode":"none"},
    closeCodes: {"1011":"The image sender failed; reconnect for a new one.","4001":"Handshake: no or invalid credentials, an API token, or a ?token= query parameter.","4003":"Handshake: Origin missing or not same-origin, or no viewer access to the project. After accept: follows message_denied project_access_denied.","4404":"Handshake: run not found or not owned. After accept: follows message_denied run_not_found."},
    requiresOrigin: true,
    startedBy: [{"field":"run_id","operationId":"generate_scenario_api_v1_projects__project_id__scenario_from_description_generate_post","parameter":"run_id","source":"response"}],
    envelopes: { "no_browser": "flat", "opening": "flat", "live": "flat", "blocked": "flat", "blank_page": "flat", "invalid_watch": "flat", "take_refused": "flat", "lease_refused": "flat", "control_granted": "flat", "control_ended": "flat", "control_idle": "flat", "input_refused": "flat", "navigation_refused": "flat", "select_options": "flat", "file_requested": "flat", "file_refused": "flat", "file_sent": "flat", "page_dialog": "flat", "page_dialog_closed": "flat", "message_denied": "flat", "watch": "flat", "take_control": "flat", "claim_control": "flat", "hand_back": "flat", "input": "flat", "navigate": "flat", "choose_option": "flat", "send_file": "flat", "answer_dialog": "flat" },
    rawServer: [{ key: "LiveViewFrame", kind: "binary" }],
    rawClient: [],
  },
  payloadGen: {
    address: "/ws/payload-gen/{run_id}",
    params: ["run_id"],
    security: [],
    serverTypes: ["payload-gen:progress", "payload-gen:complete", "payload-gen:error"],
    clientTypes: [],
    terminalFrames: ["payload-gen:complete", "payload-gen:error"],
    replay: {"mode":"none"},
    closeCodes: {},
    requiresOrigin: false,
    startedBy: [{"field":"run_id","operationId":"generate_payloads_async_api_v1_projects__project_id__generate_payloads_async_post","parameter":"run_id","source":"response"}],
    envelopes: { "payload-gen:progress": "payload", "payload-gen:complete": "payload", "payload-gen:error": "payload" },
    rawServer: [],
    rawClient: [],
  },
  projectExecution: {
    address: "/ws/projects/{project_id}/executions/{execution_id}",
    params: ["project_id", "execution_id"],
    security: [],
    serverTypes: ["heartbeat"],
    clientTypes: [],
    terminalFrames: [],
    replay: {"mode":"none"},
    closeCodes: {"1008":"Token missing or under 16 chars, or run not found in project (before accept)","1013":"100 connections server-wide or 10 for this execution (before accept)"},
    requiresOrigin: false,
    startedBy: [{"field":"execution_id","operationId":"execute_adhoc_api_v1_projects__project_id__execute_post","parameter":"execution_id","source":"response"},{"field":"execution_id","operationId":"retry_execution_api_v1_projects__project_id__executions__execution_id__retry_post","parameter":"execution_id","source":"response"}],
    envelopes: { "heartbeat": "flat" },
    rawServer: [{ key: "ProjectExecutionPong", kind: "text", text: "pong" }],
    rawClient: [{ key: "ProjectExecutionPing", kind: "text", text: "ping" }],
  },
  projectSetup: {
    address: "/ws/project-setup/{run_id}",
    params: ["run_id"],
    security: [],
    serverTypes: ["project-setup:connected", "project-setup:snapshot", "project-setup:progress", "project-setup:log", "project-setup:readiness", "project-setup:analysis_complete", "project-setup:project_created", "project-setup:complete", "project-setup:error", "project-setup:pong"],
    clientTypes: ["project-setup:ping"],
    terminalFrames: ["project-setup:complete", "project-setup:error"],
    replay: {"mode":"state"},
    closeCodes: {},
    requiresOrigin: false,
    startedBy: [{"field":"run_id","operationId":"analyze_project_setup_api_v1_project_setup_analyze_post","parameter":"run_id","source":"response"},{"field":"run_id","operationId":"analyze_project_setup_for_project_api_v1_projects__project_id__setup_analyze_post","parameter":"run_id","source":"response"}],
    envelopes: { "project-setup:connected": "payload", "project-setup:snapshot": "payload", "project-setup:progress": "payload", "project-setup:log": "payload", "project-setup:readiness": "payload", "project-setup:analysis_complete": "payload", "project-setup:project_created": "payload", "project-setup:complete": "payload", "project-setup:error": "payload", "project-setup:pong": "payload", "project-setup:ping": "flat" },
    rawServer: [],
    rawClient: [],
  },
  refine: {
    address: "/ws/flow-suggestions-refine/{job_id}",
    params: ["job_id"],
    security: [],
    serverTypes: ["flow-suggestions-refine:progress", "flow-suggestions-refine:complete", "flow-suggestions-refine:error", "flow-suggestions-refine:cancelled"],
    clientTypes: [],
    terminalFrames: ["flow-suggestions-refine:complete", "flow-suggestions-refine:error", "flow-suggestions-refine:cancelled"],
    replay: {"mode":"state"},
    closeCodes: {"4404":"Job unknown to this process (restart or expired); sent after a RefineError with reason job_not_found."},
    requiresOrigin: false,
    startedBy: [{"field":"job_id","operationId":"suggest_refined_api_v1_projects__project_id__flow_suggestions_refine_post","parameter":"job_id","source":"response"}],
    envelopes: { "flow-suggestions-refine:progress": "payload", "flow-suggestions-refine:complete": "payload", "flow-suggestions-refine:error": "payload", "flow-suggestions-refine:cancelled": "payload" },
    rawServer: [],
    rawClient: [],
  },
  scenario: {
    address: "/ws/gatling-scenario/{run_id}",
    params: ["run_id"],
    security: [],
    serverTypes: ["gatling-scenario:progress", "gatling-scenario:complete", "gatling-scenario:error", "gatling-scenario:cancelled"],
    clientTypes: [],
    terminalFrames: ["gatling-scenario:complete", "gatling-scenario:error", "gatling-scenario:cancelled"],
    replay: {"mode":"state","once":true},
    closeCodes: {},
    requiresOrigin: false,
    startedBy: [{"field":"run_id","operationId":"generate_scenario_async_api_v1_projects__project_id__gatling_scenarios_generate_async_post","parameter":"run_id","source":"response"},{"field":"run_id","operationId":"regenerate_scenario_async_api_v1_projects__project_id__gatling_scenarios__scenario_id__regenerate_async_post","parameter":"run_id","source":"response"}],
    envelopes: { "gatling-scenario:progress": "payload", "gatling-scenario:complete": "payload", "gatling-scenario:error": "payload", "gatling-scenario:cancelled": "payload" },
    rawServer: [],
    rawClient: [],
  },
  testTypes: {
    address: "/ws/test-types/{run_id}",
    params: ["run_id"],
    security: [],
    serverTypes: ["test-types:progress", "test-types:complete", "test-types:error"],
    clientTypes: [],
    terminalFrames: ["test-types:complete", "test-types:error"],
    replay: {"mode":"none"},
    closeCodes: {},
    requiresOrigin: false,
    startedBy: [{"field":"run_id","operationId":"suggest_test_types_async_api_v1_projects__project_id__test_types_suggest_async_post","parameter":"run_id","source":"response"},{"field":"run_id","operationId":"generate_test_types_async_api_v1_projects__project_id__test_types_generate_async_post","parameter":"run_id","source":"response"}],
    envelopes: { "test-types:progress": "payload", "test-types:complete": "payload", "test-types:error": "payload" },
    rawServer: [],
    rawClient: [],
  },
} as const satisfies ChannelMetadata;

export type ChannelId = keyof typeof CHANNELS;
