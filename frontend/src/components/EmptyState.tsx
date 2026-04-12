import { type ReactNode } from "react";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={`flex items-center justify-center text-text-muted ${className ?? ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="text-center">
        {icon ? <div className="mb-4 text-5xl">{icon}</div> : null}
        <p className="text-lg font-medium text-text-secondary">{title}</p>
        {description ? <p className="mt-2 text-sm">{description}</p> : null}
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-hover"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
