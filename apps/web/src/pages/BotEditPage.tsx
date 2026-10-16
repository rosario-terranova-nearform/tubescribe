import { useBot } from '@/api/bots.ts';
import { BotForm } from '@/components/BotForm.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Link, useParams } from 'react-router';

export function BotEditPage() {
  const { id = '' } = useParams<{ id: string }>();
  const botQuery = useBot(id);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Edit bot</h1>
      {botQuery.isPending && (
        <div className="flex max-w-2xl flex-col gap-4" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
      {botQuery.isError && (
        <>
          <p role="alert" className="text-sm text-destructive">
            Could not load bot {id}: {botQuery.error.message}
          </p>
          <p>
            <Link to="/bots" className="text-sm font-medium underline">
              Back to bots
            </Link>
          </p>
        </>
      )}
      {botQuery.data && <BotForm bot={botQuery.data.bot} />}
    </section>
  );
}
