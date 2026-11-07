/** Keep a failed preparation readable without discarding its complete diagnostics. */
export function previewErrorSummary(message: string): { summary: string; details: string[] } {
  const details = [
    ...new Set(
      message
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  if (!details.length) return { summary: 'Preview could not complete this command.', details: [] };
  if (details.length > 1)
    return {
      summary: `Preview could not complete this command (${details.length} issues).`,
      details,
    };
  const detail = details[0]!;
  return detail.length > 200
    ? { summary: `${detail.slice(0, 197)}…`, details }
    : { summary: detail, details: [] };
}
