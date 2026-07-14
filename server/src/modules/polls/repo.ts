import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CreatorPollResultsDto,
  EpisodePollDto,
  EpisodePollPutBody,
  PollQuestion,
  PublicPollResultsDto,
} from "@harborfm/shared";
import {
  POLL_NO_OPTION_ID,
  POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH,
  POLL_YES_OPTION_ID,
  pollQuestionsSchema,
} from "@harborfm/shared";
import { drizzleDb } from "../../db/index.js";
import {
  episodePollAnswers,
  episodePollSubmissions,
  episodePolls,
  episodes,
  podcasts,
} from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";

export type EpisodePollRow = typeof episodePolls.$inferSelect;
export type PollSubmissionRow = typeof episodePollSubmissions.$inferSelect;

export function parseQuestionsJson(raw: string): PollQuestion[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    const result = pollQuestionsSchema.safeParse(parsed);
    if (!result.success) return [];
    return result.data.map((q) => {
      if (q.type === "short_answer") {
        return {
          ...q,
          maxLength: q.maxLength ?? POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH,
        };
      }
      return q;
    });
  } catch {
    return [];
  }
}

export function rowToDto(row: EpisodePollRow): EpisodePollDto {
  return {
    id: row.id,
    episodeId: row.episodeId,
    enabled: Boolean(row.enabled),
    startAt: row.startAt ?? null,
    endAt: row.endAt ?? null,
    requireEmail: Boolean(row.requireEmail),
    publicResults: Boolean(row.publicResults),
    limitOneVotePerIp: Boolean(row.limitOneVotePerIp),
    questions: parseQuestionsJson(row.questionsJson),
    updatedAt: row.updatedAt,
  };
}

export function getPollByEpisodeId(episodeId: string): EpisodePollRow | undefined {
  return drizzleDb
    .select()
    .from(episodePolls)
    .where(eq(episodePolls.episodeId, episodeId))
    .limit(1)
    .get();
}

export function getPollById(pollId: string): EpisodePollRow | undefined {
  return drizzleDb
    .select()
    .from(episodePolls)
    .where(eq(episodePolls.id, pollId))
    .limit(1)
    .get();
}

export function upsertPoll(
  episodeId: string,
  body: EpisodePollPutBody,
  existingId?: string,
): EpisodePollRow {
  const now = sqlNow();
  const questionsJson = JSON.stringify(body.questions);
  if (existingId) {
    drizzleDb
      .update(episodePolls)
      .set({
        enabled: body.enabled,
        startAt: body.startAt ?? null,
        endAt: body.endAt ?? null,
        requireEmail: body.requireEmail,
        publicResults: body.publicResults,
        limitOneVotePerIp: body.limitOneVotePerIp,
        questionsJson,
        updatedAt: now,
      })
      .where(eq(episodePolls.id, existingId))
      .run();
    const row = getPollById(existingId);
    if (!row) throw new Error("Poll not found after update");
    return row;
  }
  const id = nanoid();
  drizzleDb
    .insert(episodePolls)
    .values({
      id,
      episodeId,
      enabled: body.enabled,
      startAt: body.startAt ?? null,
      endAt: body.endAt ?? null,
      requireEmail: body.requireEmail,
      publicResults: body.publicResults,
      limitOneVotePerIp: body.limitOneVotePerIp,
      questionsJson,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = getPollById(id);
  if (!row) throw new Error("Poll not found after insert");
  return row;
}

/** Empty poll DTO when none exists yet. */
export function emptyPollDto(episodeId: string): EpisodePollDto {
  return {
    id: "",
    episodeId,
    enabled: false,
    startAt: null,
    endAt: null,
    requireEmail: false,
    publicResults: false,
    limitOneVotePerIp: false,
    questions: [],
    updatedAt: "",
  };
}

export function isPollActiveNow(poll: EpisodePollRow, nowMs = Date.now()): boolean {
  if (!poll.enabled) return false;
  if (poll.startAt) {
    const start = Date.parse(poll.startAt);
    if (!Number.isNaN(start) && nowMs < start) return false;
  }
  if (poll.endAt) {
    const end = Date.parse(poll.endAt);
    if (!Number.isNaN(end) && nowMs > end) return false;
  }
  return true;
}

export function getEpisodePodcastSlugs(episodeId: string): {
  podcastId: string;
  podcastSlug: string;
  episodeSlug: string;
} | null {
  const row = drizzleDb
    .select({
      podcastId: episodes.podcastId,
      podcastSlug: podcasts.slug,
      episodeSlug: episodes.slug,
    })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
  if (!row?.podcastSlug || !row.episodeSlug) return null;
  return {
    podcastId: row.podcastId,
    podcastSlug: row.podcastSlug,
    episodeSlug: row.episodeSlug,
  };
}

export function findSubmissionByEmail(
  pollId: string,
  emailNormalized: string,
): PollSubmissionRow | undefined {
  return drizzleDb
    .select()
    .from(episodePollSubmissions)
    .where(
      and(
        eq(episodePollSubmissions.pollId, pollId),
        eq(episodePollSubmissions.emailNormalized, emailNormalized),
      ),
    )
    .limit(1)
    .get();
}

export function findSubmissionByIpHash(
  pollId: string,
  ipHash: string,
): PollSubmissionRow | undefined {
  return drizzleDb
    .select()
    .from(episodePollSubmissions)
    .where(
      and(
        eq(episodePollSubmissions.pollId, pollId),
        eq(episodePollSubmissions.ipHash, ipHash),
      ),
    )
    .limit(1)
    .get();
}

export function findSubmissionByClientKey(
  pollId: string,
  clientKey: string,
): PollSubmissionRow | undefined {
  return drizzleDb
    .select()
    .from(episodePollSubmissions)
    .where(
      and(
        eq(episodePollSubmissions.pollId, pollId),
        eq(episodePollSubmissions.clientKey, clientKey),
      ),
    )
    .limit(1)
    .get();
}

export function findSubmissionByVerificationToken(
  tokenHash: string,
): PollSubmissionRow | undefined {
  return drizzleDb
    .select()
    .from(episodePollSubmissions)
    .where(eq(episodePollSubmissions.emailVerificationTokenHash, tokenHash))
    .limit(1)
    .get();
}

export function setSubmissionVerified(submissionId: string): void {
  drizzleDb
    .update(episodePollSubmissions)
    .set({
      verified: true,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    })
    .where(eq(episodePollSubmissions.id, submissionId))
    .run();
}

export function createSubmission(input: {
  pollId: string;
  episodeId: string;
  email: string | null;
  emailNormalized: string | null;
  verified: boolean;
  emailVerificationTokenHash: string | null;
  emailVerificationExpiresAt: string | null;
  ipHash: string | null;
  clientKey: string;
  answers: Array<{ questionId: string; optionId?: string | null; textValue?: string | null }>;
}): string {
  const id = nanoid();
  const now = sqlNow();
  drizzleDb
    .insert(episodePollSubmissions)
    .values({
      id,
      pollId: input.pollId,
      episodeId: input.episodeId,
      email: input.email,
      emailNormalized: input.emailNormalized,
      verified: input.verified,
      emailVerificationTokenHash: input.emailVerificationTokenHash,
      emailVerificationExpiresAt: input.emailVerificationExpiresAt,
      ipHash: input.ipHash,
      clientKey: input.clientKey,
      createdAt: now,
    })
    .run();
  for (const a of input.answers) {
    drizzleDb
      .insert(episodePollAnswers)
      .values({
        id: nanoid(),
        submissionId: id,
        questionId: a.questionId,
        optionId: a.optionId ?? null,
        textValue: a.textValue ?? null,
      })
      .run();
  }
  return id;
}

function questionOptions(q: PollQuestion): { id: string; label: string }[] {
  if (q.type === "multiple_choice") return q.options;
  if (q.type === "yes_no") {
    return [
      { id: POLL_YES_OPTION_ID, label: "Yes" },
      { id: POLL_NO_OPTION_ID, label: "No" },
    ];
  }
  return [];
}

function percentNearestTwo(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((100 * count) / total / 2) * 2;
}

function percentExact(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((100 * count) / total);
}

/**
 * Aggregate results. When requireEmail, only verified submissions count for public %s.
 * Creator mode can pass verifiedFilter: 'all' | 'verified' | 'unverified'.
 * Public percentages are rounded to the nearest 2%. Short-answer questions are omitted.
 */
export function aggregatePublicResults(
  poll: EpisodePollRow,
  opts?: { verifiedFilter?: "all" | "verified" | "unverified" },
): PublicPollResultsDto {
  const questions = parseQuestionsJson(poll.questionsJson);
  const requireEmail = Boolean(poll.requireEmail);
  const filter = opts?.verifiedFilter ?? (requireEmail ? "verified" : "all");

  let submissions = drizzleDb
    .select()
    .from(episodePollSubmissions)
    .where(eq(episodePollSubmissions.pollId, poll.id))
    .all();

  if (filter === "verified") {
    submissions = submissions.filter((s) => s.verified);
  } else if (filter === "unverified") {
    submissions = submissions.filter((s) => !s.verified);
  }

  const submissionIds = submissions.map((s) => s.id);
  const answers =
    submissionIds.length === 0
      ? []
      : drizzleDb
          .select()
          .from(episodePollAnswers)
          .where(inArray(episodePollAnswers.submissionId, submissionIds))
          .all();

  const resultQuestions: PublicPollResultsDto["questions"] = [];
  for (const q of questions) {
    if (q.type !== "multiple_choice" && q.type !== "yes_no") continue;
    const qAnswers = answers.filter((a) => a.questionId === q.id);
    const optsList = questionOptions(q);
    const total = qAnswers.filter((a) => a.optionId).length;
    resultQuestions.push({
      questionId: q.id,
      type: q.type,
      prompt: q.prompt,
      options: optsList.map((o) => {
        const count = qAnswers.filter((a) => a.optionId === o.id).length;
        return { optionId: o.id, label: o.label, percent: percentNearestTwo(count, total) };
      }),
    });
  }
  return { questions: resultQuestions };
}

export function aggregateCreatorResults(
  poll: EpisodePollRow,
  verifiedFilter: "all" | "verified" | "unverified" = "all",
): CreatorPollResultsDto {
  const questions = parseQuestionsJson(poll.questionsJson);
  let submissions = drizzleDb
    .select()
    .from(episodePollSubmissions)
    .where(eq(episodePollSubmissions.pollId, poll.id))
    .orderBy(desc(episodePollSubmissions.createdAt))
    .all();

  if (verifiedFilter === "verified") {
    submissions = submissions.filter((s) => s.verified);
  } else if (verifiedFilter === "unverified") {
    submissions = submissions.filter((s) => !s.verified);
  }

  const byId = new Map(submissions.map((s) => [s.id, s]));
  const submissionIds = submissions.map((s) => s.id);
  const answers =
    submissionIds.length === 0
      ? []
      : drizzleDb
          .select()
          .from(episodePollAnswers)
          .where(inArray(episodePollAnswers.submissionId, submissionIds))
          .all();

  const resultQuestions: CreatorPollResultsDto["questions"] = [];
  for (const q of questions) {
    const qAnswers = answers.filter((a) => a.questionId === q.id);
    if (q.type === "short_answer") {
      resultQuestions.push({
        questionId: q.id,
        type: q.type,
        prompt: q.prompt,
        totalAnswers: qAnswers.filter((a) => (a.textValue ?? "").trim()).length,
        shortAnswers: qAnswers
          .filter((a) => (a.textValue ?? "").trim())
          .map((a) => {
            const sub = byId.get(a.submissionId);
            return {
              text: String(a.textValue ?? "").trim(),
              verified: Boolean(sub?.verified),
              email: sub?.email ?? null,
              createdAt: sub?.createdAt ?? "",
            };
          }),
      });
      continue;
    }
    const optsList = questionOptions(q);
    const total = qAnswers.filter((a) => a.optionId).length;
    resultQuestions.push({
      questionId: q.id,
      type: q.type,
      prompt: q.prompt,
      totalAnswers: total,
      options: optsList.map((o) => {
        const count = qAnswers.filter((a) => a.optionId === o.id).length;
        return {
          optionId: o.id,
          label: o.label,
          count,
          percent: percentExact(count, total),
        };
      }),
    });
  }

  const emailMap = new Map<string, { email: string; verified: boolean; createdAt: string; n: number }>();
  for (const s of submissions) {
    const email = (s.email ?? "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    const prev = emailMap.get(key);
    if (prev) {
      prev.n += 1;
    } else {
      emailMap.set(key, {
        email,
        verified: Boolean(s.verified),
        createdAt: s.createdAt,
        n: 1,
      });
    }
  }

  return {
    questions: resultQuestions,
    emails: [...emailMap.values()].map(({ email, verified, createdAt }) => ({
      email,
      verified,
      createdAt,
    })),
    totalSubmissions: submissions.length,
  };
}

/** Soft uniqueness helper exposed for route errors */
export function countSubmissions(pollId: string): number {
  const row = drizzleDb
    .select({ count: sql<number>`count(*)`.as("count") })
    .from(episodePollSubmissions)
    .where(eq(episodePollSubmissions.pollId, pollId))
    .get();
  return Number(row?.count ?? 0);
}
