// API contract registry: Zod request/response schemas + the endpoint list that
// drives OpenAPI generation and (later) the Rust terminal client.
export * from './schemas';
export { endpoints } from './endpoints';
export type { EndpointDef } from './endpoints';
