import { useBots } from '@/api/bots.ts';
import { BotCard } from '@/components/BotCard.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Link } from 'react-router';

export function BotsPage() {
  const botsQuery = useBots();

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Bots</h1>
        <Button asChild>
          <Link to="/bots/new">New bot</Link>
        </Button>
      </div>
      {botsQuery.isPending && <p className="text-sm text-muted-foreground">Loading bots…</p>}
      {botsQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load bots: {botsQuery.error.message}
        </p>
      )}
      {botsQuery.data?.bots.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No bots yet — create one to chat over your sources.
        </p>
      )}
      <div className="grid gap-3">
        {botsQuery.data?.bots.map((bot) => (
          <BotCard key={bot.id} bot={bot} />
        ))}
      </div>
    </section>
  );
}
