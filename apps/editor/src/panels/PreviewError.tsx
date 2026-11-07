import { previewErrorSummary } from './previewErrorSummary';

export function PreviewError({
  message,
  className = 'preview-transition-error',
}: {
  message: string;
  className?: string;
}) {
  const issue = previewErrorSummary(message);
  return (
    <div className={`${className} preview-error`} role="alert">
      <span>{issue.summary}</span>
      {issue.details.length > 0 && (
        <details>
          <summary>Show details</summary>
          <ul>
            {issue.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
