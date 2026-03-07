import Link from 'next/link';
import { EventCard } from '@/components/EventCard';
import styles from './page.module.css';

interface HistoricalEvent {
  slug: string;
  title: string;
  year: number;
  description: string;
  places: string[];
}

const EVENTS: HistoricalEvent[] = [
  {
    slug: 'fall-of-constantinople',
    title: 'Fall of Constantinople',
    year: 1453,
    description: 'The Ottoman conquest that ended the Byzantine Empire',
    places: ['Constantinople', 'Edirne', 'Galata'],
  },
  {
    slug: 'silk-road',
    title: 'The Silk Road',
    year: 200,
    description: 'Ancient trade network connecting East and West',
    places: ["Xi'an", 'Samarkand', 'Baghdad', 'Constantinople'],
  },
  {
    slug: 'roman-expansion',
    title: 'Roman Expansion',
    year: -44,
    description: 'The growth of the Roman Republic into an empire',
    places: ['Rome', 'Carthage', 'Alexandria', 'Jerusalem'],
  },
  {
    slug: 'age-of-exploration',
    title: 'Age of Exploration',
    year: 1492,
    description: 'European voyages that mapped the world',
    places: ['Lisbon', 'Seville', 'Calicut', 'Tenochtitlan'],
  },
];

export default function EventsPage() {
  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Historical Events</h1>
      <p className={styles.subtitle}>Explore famous events through interactive map sequences</p>
      <div className={styles.grid}>
        {EVENTS.map((event) => (
          <Link key={event.slug} href={`/events/${event.slug}`} className={styles.link}>
            <EventCard event={event} />
          </Link>
        ))}
      </div>
    </div>
  );
}
