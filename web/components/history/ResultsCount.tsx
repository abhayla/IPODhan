'use client';

interface ResultsCountProps {
  total: number;
  showing: number;
  page: number;
  limit: number;
}

export function ResultsCount({ total, page, limit }: ResultsCountProps) {
  const startIndex = (page - 1) * limit + 1;
  const endIndex = Math.min(page * limit, total);

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No results found
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      Showing <span className="font-medium text-foreground">{startIndex}-{endIndex}</span> of{' '}
      <span className="font-medium text-foreground">{total}</span> historical IPOs
    </p>
  );
}
