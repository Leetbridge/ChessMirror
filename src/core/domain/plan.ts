import { z } from "zod";
import { GameSchema } from "./game";

export const EvidenceRefSchema = z.object({
  gameId: GameSchema.shape.id,
  ply: z.number().int().positive(),
  note: z.string().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const SeveritySchema = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const DrillSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["chess", "soft_skill"]),
  title: z.string().min(1),
  description: z.string().min(1),
  /** Lichess puzzle themes to draw from, for chess drills. */
  puzzleThemes: z.array(z.string().min(1)).optional(),
});
export type Drill = z.infer<typeof DrillSchema>;

const findingBase = {
  id: z.string().min(1),
  /** Detector that produced it, e.g. "time-trouble-blunders". */
  detector: z.string().min(1),
};

export const DetectedFindingSchema = z.object({
  ...findingBase,
  status: z.literal("detected"),
  evidence: z.array(EvidenceRefSchema).min(1),
  severity: SeveritySchema,
  /** 0 to 1. */
  confidence: z.number().min(0).max(1),
  /** Plain language, hypothesis wording ("consistent with", "may suggest"). */
  explanation: z.string().min(1),
  chessDrill: DrillSchema,
  softSkillDrill: DrillSchema,
});
export type DetectedFinding = z.infer<typeof DetectedFindingSchema>;

export const InsufficientDataFindingSchema = z.object({
  ...findingBase,
  status: z.literal("insufficient_data"),
  reason: z.string().min(1),
});
export type InsufficientDataFinding = z.infer<typeof InsufficientDataFindingSchema>;

export const FindingSchema = z.discriminatedUnion("status", [
  DetectedFindingSchema,
  InsufficientDataFindingSchema,
]);
export type Finding = z.infer<typeof FindingSchema>;

export const PlanSchema = z.object({
  id: z.string().min(1),
  /** ISO 8601 date-time. */
  createdAt: z.iso.datetime(),
  findingIds: z.array(z.string().min(1)),
  chessDrills: z.array(DrillSchema),
  softSkillDrills: z.array(DrillSchema),
  puzzleThemes: z.array(z.string().min(1)),
});
export type Plan = z.infer<typeof PlanSchema>;
