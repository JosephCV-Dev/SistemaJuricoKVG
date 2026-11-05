export const showDate = (date: string) =>
  new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeZone: 'America/Merida',
  }).format(new Date(date));
