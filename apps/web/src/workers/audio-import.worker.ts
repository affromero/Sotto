import { Job } from 'bullmq';
import { ImportAudioPayload, notificationQueue, featureComputationQueue, addJob, JobType } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { markPodcastFailed } from '@/lib/pipeline-resume';
import { downloadFile, uploadPodcastAudio, deleteFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { createSttProvider } from '@/lib/providers/stt';
import { parseTranscript, diarizeSpeakers } from '@/lib/transcript-parser';
import { generateImportMetadata, isMetadataDifferent } from '@/lib/import-metadata-generator';
import { getAudioDuration } from '@/lib/audio-stitcher';
import { getAiKey } from '@/lib/byok';
import { resolveAiModelAndProvider, getCheapestModelForProvider, type AiProviderId } from '@/lib/providers/ai-registry';
import { detectLanguage } from '@/lib/language-detect';
import { getSttProviderMeta } from '@/lib/providers/stt-registry';
import { logUsage } from '@/lib/usage-logger';
import { matchTopicTags, TAG_PARENT_MAP } from '@/lib/topic-tagger';
import { consumeFreeGeneration } from '@/lib/generation-gate';
import { hasByokKey } from '@/lib/byok';
import { generateFingerprint, findDuplicates } from '@/lib/audio-fingerprint';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, mkdir, rm } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Audio import worker: transcribe + diarize + create podcast segments
 * Handles the full pipeline for user-uploaded audio podcasts
 */
export async function processAudioImport(job: Job<ImportAudioPayload>): Promise<void> {
  const { podcastId, userId, audioKey, transcriptText, sttProvider, sttModel, sttApiKey, generateMetadata } =
    job.data;

  logger.info('Starting audio import', {
    podcastId,
    userId,
    hasTranscript: !!transcriptText,
    sttProvider: sttProvider ?? 'openai',
  });

  const tmpDir = path.join(os.tmpdir(), `sotto-import-${crypto.randomUUID()}`);

  try {
    await mkdir(tmpDir, { recursive: true });

    // Idempotency: if import already completed (PodcastVersion exists with audio), skip everything
    const existingVersion = await prisma.podcastVersion.findFirst({
      where: { podcastId },
      select: { audioUrl: true, version: true, id: true },
    });

    if (existingVersion?.audioUrl) {
      logger.info('Import already completed, setting READY', { podcastId });

      const podcast = await prisma.podcast.findUniqueOrThrow({
        where: { id: podcastId },
        select: { duration: true, fileSize: true },
      });

      await prisma.podcast.update({
        where: { id: podcastId },
        data: {
          status: 'READY',
          audioUrl: existingVersion.audioUrl,
          currentVersion: existingVersion.version,
          duration: podcast.duration,
          fileSize: podcast.fileSize,
        },
      });

      await addJob(featureComputationQueue, JobType.COMPUTE_FEATURES, {
        scope: 'podcast' as const,
        targetId: podcastId,
      });

      await job.updateProgress(100);
      return;
    }

    // Resolve user's BYOK AI key for diarization + metadata generation
    const aiKey = await getAiKey(userId);
    const userPlan = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } });
    const { model: aiModel, provider: aiProvider } = await resolveAiModelAndProvider({ aiKey, plan: userPlan.plan as 'FREE' | 'PRO' });
    const cheapModel = getCheapestModelForProvider(aiProvider as AiProviderId) ?? aiModel;

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'IMPORTING' },
    });
    await job.updateProgress(5);

    const ext = path.extname(audioKey) || '.mp3';
    const originalPath = path.join(tmpDir, `original${ext}`);
    const normalizedPath = path.join(tmpDir, 'normalized.mp3');

    logger.info('Downloading audio from R2', { audioKey });
    const audioBuffer = await downloadFile(audioKey);
    await writeFile(originalPath, audioBuffer);
    await job.updateProgress(10);

    logger.info('Validating and normalizing audio with FFmpeg');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      originalPath,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-filter:a',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      normalizedPath,
    ]);
    await job.updateProgress(20);

    // Generate audio fingerprint for duplicate detection
    logger.info('Generating audio fingerprint', { podcastId });
    let fingerprintData: { fingerprint: number[]; duration: number } | null = null;
    try {
      fingerprintData = await generateFingerprint(normalizedPath);
    } catch (err) {
      logger.warn('Failed to generate audio fingerprint — continuing without duplicate check', {
        podcastId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const duration = await getAudioDuration(normalizedPath);
    const fileSize = (await import('fs/promises')).stat(normalizedPath).then((s) => s.size);

    logger.info('Audio normalized', { duration: String(Math.round(duration)) });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'TRANSCRIBING' },
    });
    await job.updateProgress(30);

    let segments;

    if (transcriptText) {
      logger.info('Parsing provided transcript');
      segments = await parseTranscript(transcriptText);
      await job.updateProgress(70);

      const uniqueSpeakers = new Set(segments.map((s) => s.speaker));
      if (uniqueSpeakers.size < 2) {
        logger.info('Running speaker diarization on parsed transcript');
        const whisperSegments = segments.map((s) => ({
          start: s.startTime ?? 0,
          end: s.endTime ?? 0,
          text: s.text,
        }));
        segments = await diarizeSpeakers(whisperSegments, aiKey?.apiKey, cheapModel, aiProvider);
      }
    } else {
      logger.info('Transcribing audio', { provider: sttProvider ?? 'openai', model: sttModel ?? 'default' });
      const provider = createSttProvider(sttProvider, sttApiKey, sttModel);
      const normalizedBuffer = await import('fs/promises').then((fs) =>
        fs.readFile(normalizedPath)
      );
      const transcription = await provider.transcribe(normalizedBuffer);

      const sttId = sttProvider ?? 'openai';
      const sttMeta = getSttProviderMeta(sttId);
      const durationMin = duration / 60;
      logUsage({
        service: sttId,
        model: sttModel ?? sttMeta.defaultModel,
        category: 'stt_transcription',
        totalCost: durationMin * sttMeta.platformCostPerMinute,
        podcastId,
        userId,
        metadata: { durationSeconds: Math.round(duration) },
      });

      await job.updateProgress(70);

      logger.info('Running speaker diarization');
      segments = await diarizeSpeakers(transcription.segments, aiKey?.apiKey, cheapModel, aiProvider);
    }

    await job.updateProgress(75);

    // Always generate AI metadata from transcript
    try {
      const fullText = segments.map((s) => s.text).join(' ');
      const metadata = await generateImportMetadata(fullText, aiKey?.apiKey, cheapModel, aiProvider);

      if (generateMetadata) {
        // User didn't provide title — apply AI metadata directly
        await prisma.podcast.update({
          where: { id: podcastId },
          data: {
            title: metadata.title,
            topic: metadata.topic,
          },
        });

        logger.info('Applied AI-generated metadata', {
          podcastId,
          title: metadata.title,
        });
      } else {
        // User provided their own title — store as suggestion if meaningfully different
        const podcast = await prisma.podcast.findUniqueOrThrow({
          where: { id: podcastId },
          select: { title: true, topic: true },
        });

        const titleDifferent = isMetadataDifferent(podcast.title, metadata.title);
        const topicDifferent = podcast.topic
          ? isMetadataDifferent(podcast.topic, metadata.topic)
          : metadata.topic.length >= 10;

        if (titleDifferent || topicDifferent) {
          await prisma.podcast.update({
            where: { id: podcastId },
            data: {
              suggestedTitle: titleDifferent ? metadata.title : null,
              suggestedTopic: topicDifferent ? metadata.topic : null,
            },
          });

          logger.info('Stored AI metadata suggestions', {
            podcastId,
            suggestedTitle: titleDifferent ? metadata.title : null,
          });
        }
      }
    } catch (err) {
      logger.warn('Failed to generate import metadata — continuing without suggestions', {
        podcastId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await job.updateProgress(80);

    logger.info('Creating Script and Segment records', { segmentCount: String(segments.length) });

    const turns = segments.map((seg) => ({
      speaker: seg.speaker,
      text: seg.text,
    }));

    // Idempotency: only create Script if it doesn't already exist
    const existingScript = await prisma.script.findUnique({
      where: { podcastId },
      select: { id: true },
    });

    if (!existingScript) {
      await prisma.script.create({
        data: {
          podcastId,
          version: 1,
          turns,
          markdown: segments.map((s) => `**${s.speaker}:** ${s.text}`).join('\n\n'),
        },
      });
    }

    const finalAudioBuffer = await import('fs/promises').then((fs) => fs.readFile(normalizedPath));
    const audioUrl = await uploadPodcastAudio(podcastId, finalAudioBuffer);
    await job.updateProgress(85);

    const dbSegments = await Promise.all(
      segments.map((seg) =>
        prisma.segment.create({
          data: {
            podcastId,
            speaker: seg.speaker,
            text: seg.text,
            order: seg.order,
            audioUrl,
            duration: seg.endTime && seg.startTime ? seg.endTime - seg.startTime : 0,
            startTime: seg.startTime ?? 0,
          },
        })
      )
    );

    const podcastVersion = await prisma.podcastVersion.create({
      data: {
        podcastId,
        version: 1,
        changeType: 'initial',
        audioUrl,
        duration: Math.round(duration),
      },
    });

    await Promise.all(
      dbSegments.map((seg, i) =>
        prisma.podcastVersionSegment.create({
          data: {
            versionId: podcastVersion.id,
            segmentId: seg.id,
            order: i,
            startTime: segments[i].startTime ?? 0,
          },
        })
      )
    );

    await job.updateProgress(90);

    // Detect language from transcript text
    const importFullText = segments.map((s) => s.text).join(' ');
    const detectedLanguage = detectLanguage(importFullText);

    // Auto-assign language tag
    if (detectedLanguage) {
      const langSlug = `lang-${detectedLanguage}`;
      const langTag = await prisma.tag.findUnique({ where: { slug: langSlug } });
      if (langTag) {
        await prisma.podcastTag.upsert({
          where: { podcastId_tagId: { podcastId, tagId: langTag.id } },
          update: {},
          create: { podcastId, tagId: langTag.id },
        });
      }
    }

    // Auto-assign production tag
    const podcastForTags = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { isHumanContent: true },
    });
    const prodSlug = podcastForTags.isHumanContent ? 'prod-human-created' : 'prod-imported';
    const prodTag = await prisma.tag.findUnique({ where: { slug: prodSlug } });
    if (prodTag) {
      await prisma.podcastTag.upsert({
        where: { podcastId_tagId: { podcastId, tagId: prodTag.id } },
        update: {},
        create: { podcastId, tagId: prodTag.id },
      });
    }

    // Auto-assign topic tags from podcast metadata
    const podcastForTopics = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { topic: true, suggestedTopic: true },
    });
    const topicText = podcastForTopics.topic || podcastForTopics.suggestedTopic || '';
    const topicSlugs = matchTopicTags({ topic: topicText, focusAreas: [] });
    for (const slug of topicSlugs) {
      const parent = TAG_PARENT_MAP[slug];
      const slugsToAssign = parent ? [slug, parent] : [slug];
      for (const s of slugsToAssign) {
        const tag = await prisma.tag.findUnique({ where: { slug: s } });
        if (tag) {
          await prisma.podcastTag.upsert({
            where: { podcastId_tagId: { podcastId, tagId: tag.id } },
            update: {},
            create: { podcastId, tagId: tag.id },
          });
        }
      }
    }

    // Store audio fingerprint and check for duplicates
    if (fingerprintData) {
      await prisma.audioFingerprint.upsert({
        where: { podcastId },
        update: { fingerprint: fingerprintData.fingerprint, duration: fingerprintData.duration },
        create: { podcastId, fingerprint: fingerprintData.fingerprint, duration: fingerprintData.duration },
      });

      const duplicates = await findDuplicates(fingerprintData.fingerprint, fingerprintData.duration, podcastId);
      if (duplicates.length > 0) {
        logger.info('Duplicate matches found for import', {
          podcastId,
          matchCount: String(duplicates.length),
          topSimilarity: duplicates[0].similarity.toFixed(4),
        });

        // Create DuplicateMatch records
        for (const dup of duplicates) {
          await prisma.duplicateMatch.upsert({
            where: {
              sourcePodcastId_matchedPodcastId: {
                sourcePodcastId: podcastId,
                matchedPodcastId: dup.podcastId,
              },
            },
            update: { similarity: dup.similarity },
            create: {
              sourcePodcastId: podcastId,
              matchedPodcastId: dup.podcastId,
              similarity: dup.similarity,
            },
          });
        }

        // Set status to DUPLICATE_REVIEW instead of READY
        await prisma.podcast.update({
          where: { id: podcastId },
          data: {
            status: 'DUPLICATE_REVIEW',
            audioUrl,
            duration,
            fileSize: await fileSize,
            currentVersion: podcastVersion.version,
            language: detectedLanguage ?? undefined,
          },
        });

        // Notify user their import is under review
        await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
          userId,
          type: 'PODCAST_READY',
          title: 'Import Under Review',
          message: 'Your imported podcast matched existing content and is under review.',
          data: { podcastId },
        });

        // Clean up the original imported audio file from R2
        deleteFile(audioKey).catch((err) => {
          logger.warn('Failed to delete imported audio from R2', {
            podcastId,
            audioKey,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Update segment start times
        const dupCumulativeTime = segments.reduce<number[]>((acc, seg, i) => {
          const prevTime =
            i === 0
              ? 0
              : acc[i - 1] + (segments[i - 1].endTime ?? 0) - (segments[i - 1].startTime ?? 0);
          return [...acc, seg.startTime ?? prevTime];
        }, []);

        await Promise.all(
          dbSegments.map((seg, i) =>
            prisma.segment.update({
              where: { id: seg.id },
              data: { startTime: dupCumulativeTime[i] ?? 0 },
            })
          )
        );

        await job.updateProgress(100);
        logger.info('Audio import flagged for duplicate review', { podcastId });
        return;
      }
    }

    await prisma.podcast.update({
      where: { id: podcastId },
      data: {
        status: 'READY',
        audioUrl,
        duration,
        fileSize: await fileSize,
        currentVersion: podcastVersion.version,
        language: detectedLanguage ?? undefined,
      },
    });

    // Compute ML features for imported podcast
    await addJob(featureComputationQueue, JobType.COMPUTE_FEATURES, {
      scope: 'podcast' as const,
      targetId: podcastId,
    });

    // Consume free-tier quota on successful import (not at creation time)
    const importUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, plan: true },
    });
    const isByok = await hasByokKey(userId);
    const isPrivileged = importUser.role === 'ADMIN' || importUser.role === 'SYSTEM';
    if (!isByok && importUser.plan !== 'PRO' && !isPrivileged) {
      await consumeFreeGeneration(userId).catch((err) => {
        logger.warn('Failed to consume free generation', {
          podcastId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Clean up the original imported audio file from R2
    deleteFile(audioKey).catch((err) => {
      logger.warn('Failed to delete imported audio from R2', {
        podcastId,
        audioKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    const cumulativeTime = segments.reduce<number[]>((acc, seg, i) => {
      const prevTime =
        i === 0
          ? 0
          : acc[i - 1] + (segments[i - 1].endTime ?? 0) - (segments[i - 1].startTime ?? 0);
      return [...acc, seg.startTime ?? prevTime];
    }, []);

    await Promise.all(
      dbSegments.map((seg, i) =>
        prisma.segment.update({
          where: { id: seg.id },
          data: { startTime: cumulativeTime[i] ?? 0 },
        })
      )
    );

    await job.updateProgress(95);

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'PODCAST_READY',
      title: 'Import Complete',
      message: 'Your imported podcast is ready!',
      data: { podcastId },
    });

    await job.updateProgress(100);

    logger.info('Audio import complete', {
      podcastId,
      duration: String(Math.round(duration)),
      segments: String(segments.length),
    });
  } catch (err) {
    logger.error('Audio import failed', {
      podcastId,
      error: err instanceof Error ? err.message : String(err),
    });

    await markPodcastFailed(podcastId, {
      technicalError: err instanceof Error ? err.message : String(err),
    });

    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
