/**
 * Route → contract registry for every route in 02 §13.
 * `params` = path params, `query` = query string (parse the output of
 * `searchParamsToObject`), `body` = JSON body, `response` = envelope `data`.
 * `null` means the route takes no such input.
 *
 * Not listed: `GET /api/photos/:kind/:id` (public), which answers with JPEG
 * bytes rather than an envelope on success; its params are
 * `photoParamsSchema` (primitives.ts) and errors use the envelope.
 */
import type { z } from "zod";
import * as A from "./authority";
import * as D from "./departments";
import * as H from "./hotspots";
import * as I from "./issues";
import * as R from "./reports";
import * as S from "./stats";

export type RouteAccess = "public" | "citizen" | "authority";

export interface RouteContract {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly access: RouteAccess;
  readonly params: z.ZodType | null;
  readonly query: z.ZodType | null;
  readonly body: z.ZodType | null;
  readonly response: z.ZodType;
}

export const API_ROUTES = {
  createReport: {
    method: "POST",
    path: "/api/reports",
    access: "citizen",
    params: null,
    query: null,
    body: R.createReportBodySchema,
    response: R.createReportResponseSchema,
  },
  duplicateCandidates: {
    method: "GET",
    path: "/api/duplicate-candidates",
    access: "citizen",
    params: null,
    query: R.duplicateCandidatesQuerySchema,
    body: null,
    response: R.duplicateCandidatesResponseSchema,
  },
  supportReport: {
    method: "POST",
    path: "/api/issues/:id/support",
    access: "citizen",
    params: R.supportReportParamsSchema,
    query: null,
    body: R.supportReportBodySchema,
    response: R.supportReportResponseSchema,
  },
  listIssues: {
    method: "GET",
    path: "/api/issues",
    access: "public",
    params: null,
    query: I.issuesQuerySchema,
    body: null,
    response: I.issuesResponseSchema,
  },
  issueDetail: {
    method: "GET",
    path: "/api/issues/:id",
    access: "public",
    params: I.issueDetailParamsSchema,
    query: null,
    body: null,
    response: I.issueDetailResponseSchema,
  },
  myReports: {
    method: "GET",
    path: "/api/my-reports",
    access: "citizen",
    params: null,
    query: null,
    body: null,
    response: R.myReportsResponseSchema,
  },
  departments: {
    method: "GET",
    path: "/api/departments",
    access: "authority",
    params: null,
    query: null,
    body: null,
    response: D.departmentsResponseSchema,
  },
  authorityQueue: {
    method: "GET",
    path: "/api/authority/queue",
    access: "authority",
    params: null,
    query: A.authorityQueueQuerySchema,
    body: null,
    response: A.authorityQueueResponseSchema,
  },
  setPriority: {
    method: "PATCH",
    path: "/api/issues/:id/priority",
    access: "authority",
    params: I.setPriorityParamsSchema,
    query: null,
    body: I.setPriorityBodySchema,
    response: I.setPriorityResponseSchema,
  },
  assignIssue: {
    method: "POST",
    path: "/api/issues/:id/assign",
    access: "authority",
    params: I.assignIssueParamsSchema,
    query: null,
    body: I.assignIssueBodySchema,
    response: I.assignIssueResponseSchema,
  },
  transitionIssue: {
    method: "PATCH",
    path: "/api/issues/:id/status",
    // Citizens may request REOPENED once the stretch ships; the route decides.
    access: "authority",
    params: I.transitionIssueParamsSchema,
    query: null,
    body: I.transitionIssueBodySchema,
    response: I.transitionIssueResponseSchema,
  },
  resolveIssue: {
    method: "POST",
    path: "/api/issues/:id/resolution",
    access: "authority",
    params: I.resolveIssueParamsSchema,
    query: null,
    body: I.resolveIssueBodySchema,
    response: I.resolveIssueResponseSchema,
  },
  mergeIssue: {
    method: "POST",
    path: "/api/issues/:id/merge",
    access: "authority",
    params: I.mergeIssueParamsSchema,
    query: null,
    body: I.mergeIssueBodySchema,
    response: I.mergeIssueResponseSchema,
  },
  hotspots: {
    method: "GET",
    path: "/api/hotspots",
    access: "public",
    params: null,
    query: null,
    body: null,
    response: H.hotspotsResponseSchema,
  },
  regenerateHotspots: {
    method: "POST",
    path: "/api/hotspots/regenerate",
    access: "authority",
    params: null,
    query: null,
    body: null,
    response: H.regenerateHotspotsResponseSchema,
  },
  resolutionStats: {
    method: "GET",
    path: "/api/stats/resolution",
    access: "public",
    params: null,
    query: null,
    body: null,
    response: S.resolutionStatsResponseSchema,
  },
} as const satisfies Record<string, RouteContract>;

export type ApiRouteName = keyof typeof API_ROUTES;
