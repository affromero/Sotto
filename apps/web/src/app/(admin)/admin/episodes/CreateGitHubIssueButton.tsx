'use client';

import styles from './page.module.css';

interface Props {
  episodeId: string;
  title: string;
  creatorEmail: string;
  failedAtStatus: string | null;
  failedAt: string | null;
  failureReason: string | null;
  technicalError: string | null;
}

export function CreateGitHubIssueButton({
  episodeId,
  title,
  creatorEmail,
  failedAtStatus,
  failedAt,
  failureReason,
  technicalError,
}: Props) {
  function handleClick() {
    const issueTitle = `[Pipeline] ${failedAtStatus ?? 'UNKNOWN'} failure — episode ${episodeId}`;

    const MAX_ERROR_LENGTH = 3000;
    let truncatedError = technicalError ?? 'N/A';
    if (technicalError && technicalError.length > MAX_ERROR_LENGTH) {
      truncatedError = technicalError.slice(0, MAX_ERROR_LENGTH) + '\n\n[truncated...]';
    }

    const formattedTimestamp = failedAt
      ? new Date(failedAt).toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : 'N/A';

    const body = `## Pipeline Failure Report

**Episode ID:** \`${episodeId}\`
**Title:** ${title}
**Creator:** ${creatorEmail}
**Failed At Stage:** ${failedAtStatus ?? 'N/A'}
**Timestamp:** ${formattedTimestamp}

## User-Facing Error

${failureReason ?? 'N/A'}

## Technical Error

\`\`\`
${truncatedError}
\`\`\`

## Steps to Reproduce

1. Go to \`/admin/episodes\` and search for episode ID \`${episodeId}\`
2. Check the pipeline stage: \`${failedAtStatus ?? 'UNKNOWN'}\`
3. Review the technical error above

## Additional Context

<!-- Add any extra context here -->`;

    const url = `https://github.com/affromero/Sotto/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <button
      type="button"
      className={styles.githubIssueButton}
      onClick={handleClick}
      aria-label="Open GitHub issue for this failure"
    >
      Open GitHub Issue
    </button>
  );
}
