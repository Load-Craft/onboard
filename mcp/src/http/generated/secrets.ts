/**
 * Generated file - do not edit.
 * Source: contracts/loadcraft-openapi.json and contracts/secret-fields.json. Regenerate with
 * "npm run gen:api" (from mcp/).
 */

import type { OperationId } from './operations.js';

/**
 * Where the secret fields of an operation sit: in its input (`body.…`, `query.<name>`,
 * `header.<name>`, `path.<name>`) and in the body of its answer of success. A path names a property
 * by `.`, every item of a list by `[]` and every value of a map by `*`; `[secret]` is an item whose
 * `name` names a secret and `*secret` a value under a key that names one.
 */
export interface SecretPaths {
  readonly request: readonly string[];
  readonly response: readonly string[];
}

/** The secret fields of every operation that has one; `callOperation` masks what they hold. */
export const SECRET_PATHS: { readonly [Id in OperationId]?: SecretPaths } = {
  activate_asyncapi_spec_api_v1_projects__project_id__asyncapi_specs__spec_id__activate_put: { request: [], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  activate_openapi_spec_api_v1_projects__project_id__openapi_specs__spec_id__activate_put: { request: [], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  apply_copilot_proposal_api_v1_projects__project_id__flows__flow_id__copilot_apply_post: { request: [], response: ['flow.variables.*secret'] },
  apply_setup_api_v1_projects__project_id__setup_apply_post: { request: ['body.default_headers.*secret', 'body.variables.*secret'], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  connect_with_token_api_v1_projects__project_id__github_connect_token_post: { request: ['body.token'], response: [] },
  create_api_token_api_v1_auth_api_tokens_post: { request: [], response: ['token'] },
  create_batch_run_api_v1_test_templates_batch_runs_post: { request: ['body.runtime_params.*.*secret'], response: ['runtime_params.*.*secret'] },
  create_composition_api_v1_projects__project_id__gatling_compositions_post: { request: ['body.global_headers.*secret', 'body.protocol_config.proxy_password'], response: ['global_headers.*secret', 'protocol_config.proxy_password'] },
  create_environment_api_v1_environments_post: { request: ['body.auth_config.*secret', 'body.default_headers.*secret', 'body.variables.*secret'], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  create_environment_api_v1_projects__project_id__environments_post: { request: ['body.auth_config.*secret', 'body.default_headers.*secret', 'body.variables.*secret'], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  create_feeder_api_v1_projects__project_id__gatling_feeders_post: { request: ['body.jdbc_config.password', 'body.redis_config.password'], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  create_flow_api_v1_projects__project_id__flows_post: { request: ['body.variables.*secret'], response: ['variables.*secret'] },
  create_ingest_token_api_v1_projects__project_id__production_traffic_tokens_post: { request: [], response: ['secret'] },
  create_project_and_generate_api_v1_project_setup_runs__run_id__create_and_generate_post: { request: ['body.auth_config.*secret', 'body.default_headers.*secret', 'body.variables.*secret'], response: [] },
  create_project_api_v1_projects_post: { request: ['body.auth_config.*secret', 'body.default_headers.*secret', 'body.variables.*secret'], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  create_test_flow_api_v1_test_flows_post: { request: ['body.variables.*secret'], response: ['variables.*secret'] },
  duplicate_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__duplicate_post: { request: [], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  duplicate_flow_for_spec_api_v1_projects__project_id__flows__flow_id__duplicate_for_spec_post: { request: [], response: ['flow.variables.*secret'] },
  execute_adhoc_api_v1_projects__project_id__execute_post: { request: ['body.runtime_params.*secret'], response: [] },
  expand_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__expand_post: { request: [], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  gatling_feeder_jdbc_test_connection_api_v1_projects__project_id__gatling_feeders_jdbc_test_connection_post: { request: ['body.password'], response: [] },
  generate_feeder_from_rules_api_v1_projects__project_id__gatling_feeders_generate_from_rules_post: { request: [], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  generate_feeder_from_scenario_api_v1_projects__project_id__gatling_feeders_generate_from_scenario_post: { request: [], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  generate_flow_api_v1_projects__project_id__flows_generate_post: { request: [], response: ['flow.variables.*secret'] },
  generate_flow_api_v1_projects__project_id__har__har_session_id__generate_post: { request: ['body.auth_password'], response: [] },
  generate_scenario_api_v1_projects__project_id__scenario_from_description_generate_post: { request: ['body.auth_credentials.password'], response: [] },
  generate_slot_feeder_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots__slot__generate_feeder_post: { request: [], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  get_batch_run_api_v1_test_templates_batch_runs__batch_run_id__get: { request: [], response: ['runtime_params.*.*secret'] },
  get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get: { request: [], response: ['global_headers.*secret', 'protocol_config.proxy_password'] },
  get_default_environment_api_v1_projects__project_id__environments_default_get: { request: [], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  get_effective_environment_api_v1_projects__project_id__environments__environment_id__effective_get: { request: [], response: ['auth.auth_config.*secret', 'headers[secret].value', 'variables[secret].value'] },
  get_environment_api_v1_environments__env_id__get: { request: [], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  get_environment_api_v1_projects__project_id__environments__environment_id__get: { request: [], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  get_execution_api_logs_api_v1_projects__project_id__executions__execution_id__api_logs_get: { request: [], response: ['logs[].request_headers.*secret', 'logs[].response_headers.*secret'] },
  // not marked in the contract: the contract marks the cells of the rows of the flows and of their reruns by name; the whole value of each cell is masked here, and the inputs a retry replays (kept as stored, not masked by the API) are masked whole
  get_execution_api_v1_projects__project_id__executions__execution_id__get: { request: [], response: ['config_snapshot.flow_rows.*.*', 'config_snapshot.flow_rows.*.*secret', 'config_snapshot.rerun_inputs', 'config_snapshot.rerun_inputs.*[].*secret', 'config_snapshot.rerun_rows.*.*', 'config_snapshot.rerun_rows.*.*secret', 'runtime_params.*secret'] },
  // not marked in the contract: the contract marks the cells of the rows of the flows and of their reruns by name; the whole value of each cell is masked here, and the inputs a retry replays (kept as stored, not masked by the API) are masked whole
  get_execution_with_results_api_v1_projects__project_id__executions__execution_id__with_results_get: { request: [], response: ['config_snapshot.flow_rows.*.*', 'config_snapshot.flow_rows.*.*secret', 'config_snapshot.rerun_inputs', 'config_snapshot.rerun_inputs.*[].*secret', 'config_snapshot.rerun_rows.*.*', 'config_snapshot.rerun_rows.*.*secret', 'runtime_params.*secret'] },
  get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get: { request: [], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  get_flow_api_v1_projects__project_id__flows__flow_id__get: { request: [], response: ['variables.*secret'] },
  get_flow_result_api_v1_projects__project_id__executions__execution_id__results__result_id__get: { request: [], response: ['block_results[].request_headers.*secret', 'block_results[].response_headers.*secret', 'final_variables.*secret'] },
  get_flow_version_api_v1_projects__project_id__flows__flow_id__versions__version__get: { request: [], response: ['auth_evidence_snapshot'] },
  get_gatling_project_api_v1_projects__project_id__gatling_project_get: { request: [], response: ['default_headers.*secret', 'protocol_config.proxy_password'] },
  get_project_api_v1_projects__project_id__get: { request: [], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  get_test_flow_api_v1_test_flows__flow_id__get: { request: [], response: ['variables.*secret'] },
  list_compositions_api_v1_projects__project_id__gatling_compositions_get: { request: [], response: ['compositions[].global_headers.*secret', 'compositions[].protocol_config.proxy_password'] },
  list_feeders_api_v1_projects__project_id__gatling_feeders_get: { request: [], response: ['feeders[].jdbc_config.password', 'feeders[].redis_config.password'] },
  list_flow_results_api_v1_projects__project_id__executions__execution_id__results_get: { request: [], response: ['results[].block_results[].request_headers.*secret', 'results[].block_results[].response_headers.*secret', 'results[].final_variables.*secret'] },
  list_project_environments_api_v1_projects__project_id__environments_get: { request: [], response: ['items[].auth_config.*secret', 'items[].default_headers.*secret', 'items[].variables.*secret'] },
  merge_flows_route_api_v1_projects__project_id__flows_merge_post: { request: [], response: ['flow.variables.*secret'] },
  preview_feeder_snippet_api_v1_projects__project_id__gatling_feeders_preview_snippet_post: { request: ['body.jdbc_config.password', 'body.redis_config.password'], response: [] },
  regenerate_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__regenerate_post: { request: [], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  regenerate_single_feeder_column_api_v1_projects__project_id__gatling_feeders__feeder_id__regenerate_column_post: { request: [], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  repin_composition_link_api_v1_projects__project_id__gatling_compositions__composition_id__links__link_id__pin_put: { request: [], response: ['global_headers.*secret', 'protocol_config.proxy_password'] },
  replace_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__content_put: { request: [], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  restore_flow_version_api_v1_projects__project_id__flows__flow_id__versions_restore_post: { request: [], response: ['variables.*secret'] },
  restore_previous_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__restore_previous_post: { request: [], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  restore_version_api_v1_test_flows__flow_id__versions__version__restore_post: { request: [], response: ['variables.*secret'] },
  retry_execution_api_v1_projects__project_id__executions__execution_id__retry_post: { request: ['body.runtime_params.*secret'], response: [] },
  setup_gatling_project_api_v1_projects__project_id__gatling_setup_post: { request: ['body.default_headers.*secret', 'body.protocol_config.proxy_password'], response: [] },
  update_composition_api_v1_projects__project_id__gatling_compositions__composition_id__put: { request: ['body.global_headers.*secret', 'body.protocol_config.proxy_password'], response: ['global_headers.*secret', 'protocol_config.proxy_password'] },
  update_environment_api_v1_environments__env_id__put: { request: ['body.auth_config.*secret', 'body.default_headers.*secret', 'body.variables.*secret'], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  update_environment_api_v1_projects__project_id__environments__environment_id__put: { request: ['body.auth_config.*secret', 'body.default_headers.*secret', 'body.variables.*secret'], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  update_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__put: { request: ['body.jdbc_config.password', 'body.redis_config.password'], response: ['content', 'jdbc_config.password', 'redis_config.password'] },
  update_flow_api_v1_projects__project_id__flows__flow_id__put: { request: ['body.variables.*secret'], response: ['variables.*secret'] },
  update_gatling_project_api_v1_projects__project_id__gatling_project_put: { request: ['body.default_headers.*secret', 'body.protocol_config.proxy_password'], response: ['default_headers.*secret', 'protocol_config.proxy_password'] },
  update_project_api_v1_projects__project_id__put: { request: ['body.auth_config.*secret', 'body.default_headers.*secret', 'body.variables.*secret'], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  update_test_flow_api_v1_test_flows__flow_id__put: { request: ['body.variables.*secret'], response: ['variables.*secret'] },
  upload_project_asyncapi_api_v1_projects__project_id__asyncapi_post: { request: [], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  upload_project_asyncapi_file_api_v1_projects__project_id__asyncapi_upload_post: { request: [], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  upload_project_openapi_api_v1_projects__project_id__openapi_post: { request: [], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
  upload_project_openapi_file_api_v1_projects__project_id__openapi_upload_post: { request: [], response: ['auth_config.*secret', 'default_headers.*secret', 'variables.*secret'] },
};
