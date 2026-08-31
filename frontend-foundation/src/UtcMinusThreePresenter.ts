export class UtcMinusThreePresenter {
  private static readonly UTC_MINUS_THREE_MILLISECONDS = 3 * 60 * 60 * 1000;

  private readonly formatter = new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Etc/GMT+3",
    year: "2-digit",
  });

  public formatInstant(value: string | null): string {
    if (value === null) {
      return "—";
    }
    const instant = this.parse(value);
    return this.formatter.format(instant);
  }

  public formatInstantWithMilliseconds(value: string | null): string {
    if (value === null) {
      return "—";
    }
    const instant = this.parse(value);
    const local = new Date(
      instant.getTime() - UtcMinusThreePresenter.UTC_MINUS_THREE_MILLISECONDS,
    );
    const day = String(local.getUTCDate()).padStart(2, "0");
    const month = String(local.getUTCMonth() + 1).padStart(2, "0");
    const year = String(local.getUTCFullYear()).slice(-2);
    const hour = String(local.getUTCHours()).padStart(2, "0");
    const minute = String(local.getUTCMinutes()).padStart(2, "0");
    const second = String(local.getUTCSeconds()).padStart(2, "0");
    const millisecond = String(local.getUTCMilliseconds()).padStart(3, "0");
    return `${day}/${month}/${year}, ${hour}:${minute}:${second}.${millisecond}`;
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
