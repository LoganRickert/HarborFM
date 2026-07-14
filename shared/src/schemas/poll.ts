import { z } from "zod";

/** Default max length for short-answer poll questions (characters). */
export const POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH = 1000;

/** Fixed option ids for yes/no questions. */
export const POLL_YES_OPTION_ID = "yes";
export const POLL_NO_OPTION_ID = "no";

export const POLL_QUESTION_TYPES = [
  "multiple_choice",
  "yes_no",
  "short_answer",
] as const;

export type PollQuestionType = (typeof POLL_QUESTION_TYPES)[number] | (string & {});

const pollOptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200).transform((s) => s.trim()),
});

const pollQuestionBaseSchema = z.object({
  id: z.string().min(1).max(64),
  prompt: z.string().min(1).max(500).transform((s) => s.trim()),
  description: z
    .string()
    .max(2000)
    .optional()
    .transform((s) => (s != null && s.trim() !== "" ? s.trim() : undefined)),
});

export const pollQuestionSchema = z.discriminatedUnion("type", [
  pollQuestionBaseSchema.extend({
    type: z.literal("multiple_choice"),
    options: z.array(pollOptionSchema).min(2).max(12),
  }),
  pollQuestionBaseSchema.extend({
    type: z.literal("yes_no"),
  }),
  pollQuestionBaseSchema.extend({
    type: z.literal("short_answer"),
    maxLength: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .default(POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH),
  }),
]);

export type PollQuestion = z.infer<typeof pollQuestionSchema>;

export const pollQuestionsSchema = z.array(pollQuestionSchema).max(50);

export const episodePollSettingsSchema = z.object({
  enabled: z.boolean(),
  startAt: z
    .string()
    .nullable()
    .optional()
    .transform((s) => (s != null && s.trim() !== "" ? s.trim() : null)),
  endAt: z
    .string()
    .nullable()
    .optional()
    .transform((s) => (s != null && s.trim() !== "" ? s.trim() : null)),
  requireEmail: z.boolean(),
  publicResults: z.boolean(),
  limitOneVotePerIp: z.boolean(),
});

export type EpisodePollSettings = z.infer<typeof episodePollSettingsSchema>;

export const episodePollPutBodySchema = episodePollSettingsSchema.extend({
  questions: pollQuestionsSchema,
});

export type EpisodePollPutBody = z.infer<typeof episodePollPutBodySchema>;

export type EpisodePollDto = EpisodePollSettings & {
  id: string;
  episodeId: string;
  questions: PollQuestion[];
  updatedAt: string;
};

export const pollVoteAnswerSchema = z.object({
  questionId: z.string().min(1),
  optionId: z.string().min(1).optional(),
  textValue: z.string().max(5000).optional(),
});

export const pollVoteBodySchema = z.object({
  answers: z.array(pollVoteAnswerSchema).min(1).max(50),
  email: z
    .string()
    .max(320)
    .email({ message: "Please provide a valid email address" })
    .optional()
    .transform((s) => (s != null && s !== "" ? s.trim() : undefined)),
  captchaToken: z
    .string()
    .optional()
    .transform((s) => (s != null && s !== "" ? s.trim() : undefined)),
});

export type PollVoteBody = z.infer<typeof pollVoteBodySchema>;

/** Public poll metadata (no results). */
export type PublicPollDto = {
  id: string;
  requireEmail: boolean;
  publicResults: boolean;
  questions: PollQuestion[];
  alreadyVoted?: boolean;
};

export type PublicPollOptionResult = {
  optionId: string;
  label: string;
  percent: number;
};

export type PublicPollQuestionResult = {
  questionId: string;
  type: string;
  prompt: string;
  /** Choice questions only in public results. Percentages rounded to nearest 2%. Short answers omitted. */
  options?: PublicPollOptionResult[];
  responseCount?: number;
};

export type PublicPollResultsDto = {
  questions: PublicPollQuestionResult[];
};

/** Creator results: includes counts, emails, short-answer text. */
export type CreatorPollOptionResult = {
  optionId: string;
  label: string;
  count: number;
  percent: number;
};

export type CreatorPollQuestionResult = {
  questionId: string;
  type: string;
  prompt: string;
  options?: CreatorPollOptionResult[];
  shortAnswers?: Array<{
    text: string;
    verified: boolean;
    email: string | null;
    createdAt: string;
  }>;
  totalAnswers: number;
};

export type CreatorPollResultsDto = {
  questions: CreatorPollQuestionResult[];
  emails: Array<{ email: string; verified: boolean; createdAt: string }>;
  totalSubmissions: number;
};
