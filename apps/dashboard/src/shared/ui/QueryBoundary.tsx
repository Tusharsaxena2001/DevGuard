import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describeError } from "../lib/format.js";
import { EmptyState, ErrorState, LoadingState } from "./States.js";

/**
 * Renders the three states every data view has, so no page forgets one: loading, error (with retry) and empty.
 * `isEmpty` decides what "nothing to show" means for this data.
 */
export function QueryBoundary<T>({
  query,
  isEmpty,
  emptyTitle,
  emptyHint,
  children,
}: {
  query: UseQueryResult<T>;
  isEmpty?: (data: T) => boolean;
  emptyTitle?: string;
  emptyHint?: string;
  children: (data: T) => ReactNode;
}): ReactNode {
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState message={describeError(query.error)} onRetry={() => void query.refetch()} />;
  if (isEmpty?.(query.data) === true) return <EmptyState title={emptyTitle ?? "Nothing here yet"} {...(emptyHint === undefined ? {} : { hint: emptyHint })} />;
  return <>{children(query.data)}</>;
}
