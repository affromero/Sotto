import { getHealthData } from '@/lib/health';
import { HealthDashboard } from './HealthDashboard';

export const metadata = { title: 'System Health — Sotto Admin' };

export default async function HealthPage() {
  const data = await getHealthData(true);
  return <HealthDashboard initialData={data} />;
}
