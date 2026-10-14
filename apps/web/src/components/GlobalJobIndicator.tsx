import { useJobs } from '@/api/jobs.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Progress } from '@/components/ui/progress.tsx';

/**
 * Header job progress: polls GET /api/jobs every 3 s and stays hidden while
 * the corpus is idle (no queued/running jobs) or the server is unreachable.
 */
export function GlobalJobIndicator() {
  const { data } = useJobs();
  const active = (data?.jobs ?? []).filter(
    (job) => job.status === 'queued' || job.status === 'running',
  );
  if (active.length === 0) return null;

  const total = active.reduce((sum, job) => sum + job.totalItems, 0);
  const done = active.reduce((sum, job) => sum + job.processedItems + job.failedItems, 0);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex items-center gap-2" data-testid="global-job-indicator">
      <Badge variant="secondary">
        {active.length} job{active.length === 1 ? '' : 's'} running
      </Badge>
      {total > 0 && <Progress value={percent} className="w-24" aria-label="Job progress" />}
    </div>
  );
}
