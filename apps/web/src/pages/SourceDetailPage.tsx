import { PagePlaceholder } from '@/components/PagePlaceholder.tsx';
import { useParams } from 'react-router';

export function SourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PagePlaceholder
      title="Source detail"
      description={`Video grid, per-video status and re-extract for source ${id ?? ''} (task 10).`}
    />
  );
}
