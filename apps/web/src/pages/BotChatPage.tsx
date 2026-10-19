import { useBot } from '@/api/bots.ts';
import { useSources } from '@/api/sources.ts';
import { ChatSidebar } from '@/components/ChatSidebar.tsx';
import { ChatView } from '@/components/ChatView.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import type { Bot, SourceWithStatus } from '@tubescribe/shared';
import { Link, useParams, useSearchParams } from 'react-router';

/**
 * /bots/:id — the chat experience. The selected chat lives in the `?chat=`
 * search param so a reload (or shared URL) restores the conversation.
 */
export function BotChatPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const chatId = searchParams.get('chat');
  const botQuery = useBot(id);
  const sourcesQuery = useSources();

  const selectChat = (next: string | null) => {
    setSearchParams(next ? { chat: next } : {});
  };

  const bot = botQuery.data?.bot;
  const sources = sourcesQuery.data?.sources;

  return (
    <section className="flex flex-col gap-6">
      {botQuery.isPending && <p className="text-sm text-muted-foreground">Loading bot…</p>}
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
      {bot && (
        <>
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{bot.name}</h1>
              <Badge variant="secondary">{bot.modelOverride ?? 'default model'}</Badge>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/bots/${bot.id}/edit`}>Edit</Link>
            </Button>
          </div>
          <div className="flex flex-col gap-6 md:flex-row">
            <ChatSidebar botId={bot.id} activeChatId={chatId} onSelectChat={selectChat} />
            <div className="flex min-w-0 flex-1 flex-col">
              {chatId ? (
                <ChatView
                  botId={bot.id}
                  chatId={chatId}
                  emptyState={<GroundingHint bot={bot} sources={sources} />}
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Select a chat on the left, or start a new one.
                  </p>
                  <GroundingHint bot={bot} sources={sources} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Empty-state hint when the bot cannot ground answers yet: no sources
 * attached, or none of the attached sources has embedded videos. Points to
 * the Sources page; hidden once the corpus is ready.
 */
function GroundingHint({
  bot,
  sources,
}: {
  bot: Bot;
  sources: SourceWithStatus[] | undefined;
}) {
  let message: string | null = null;
  if (bot.sourceIds.length === 0) {
    message =
      'This bot has no sources attached, so answers cannot cite your transcript corpus yet. Add a source, then attach it to the bot.';
  } else if (sources) {
    const attached = sources.filter((s) => bot.sourceIds.includes(s.id));
    const embedded = attached.reduce((n, s) => n + s.status.embedded, 0);
    if (embedded === 0) {
      message =
        'This bot’s sources have no embedded transcripts yet, so answers cannot cite the corpus yet. Embedding runs after extraction — check progress on the Sources page.';
    }
  }
  if (!message) return null;
  return (
    <p className="max-w-md rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
      {message}{' '}
      <Link to="/sources" className="font-medium underline">
        Go to Sources
      </Link>
    </p>
  );
}
