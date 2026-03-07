import styles from './EventCard.module.css';

interface EventCardProps {
  event: {
    title: string;
    year: number;
    description: string;
    places: string[];
  };
}

function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

export function EventCard({ event }: EventCardProps) {
  return (
    <div className={styles.root}>
      <div className={styles.year}>{formatYear(event.year)}</div>
      <h3 className={styles.title}>{event.title}</h3>
      <p className={styles.description}>{event.description}</p>
      <div className={styles.places}>
        {event.places.map((place) => (
          <span key={place} className={styles.placeBadge}>
            {place}
          </span>
        ))}
      </div>
    </div>
  );
}
