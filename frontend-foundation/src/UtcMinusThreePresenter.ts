export class UtcMinusThreePresenter {
  private readonly formatter = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Etc/GMT+3",
  });

  public formatInstant(value: string | null): string {
    if (value === null) {
      return "—";
    }
    const instant = this.parse(value);
    return this.formatter.format(instant);
  }

  public formatAge(start: string, end: string | null, referenceNow: string): string {
    const startMillis = this.parse(start).getTime();
    const endMillis = this.parse(end ?? referenceNow).getTime();
    const totalMinutes = Math.max(0, Math.floor((endMillis - startMillis) / 60_000));
    if (totalMinutes < 60) {
      return `${totalMinutes} min`;
    }
    const totalHours = Math.floor(totalMinutes / 60);
    if (totalHours < 48) {
      return `${totalHours} h ${totalMinutes % 60} min`;
    }
    return `${Math.floor(totalHours / 24)} d ${totalHours % 24} h`;
  }

  private parse(value: string): Date {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) {
      throw new Error(`Instante ISO-8601 inválido: ${value}`);
    }
    return instant;
  }
}
