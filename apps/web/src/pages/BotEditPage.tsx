import { PagePlaceholder } from '@/components/PagePlaceholder.tsx';
import { useParams } from 'react-router';

export function BotEditPage() {
  const { id } = useParams<{ id: string }>();
  return <PagePlaceholder title="Edit bot" description={`Editing bot ${id ?? ''} (task 11).`} />;
}
