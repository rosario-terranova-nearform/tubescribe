import { PagePlaceholder } from '@/components/PagePlaceholder.tsx';
import { useParams } from 'react-router';

export function BotChatPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PagePlaceholder
      title="Bot chat"
      description={`Chat with bot ${id ?? ''}, with history and citations (task 12).`}
    />
  );
}
