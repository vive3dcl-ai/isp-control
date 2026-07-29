import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformFxRate } from './entities/platform-fx-rate.entity';

const USD_CLP = 'USDCLP';

type MindicadorRoot = {
  dolar?: { valor?: number; fecha?: string };
};

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(
    @InjectRepository(PlatformFxRate)
    private readonly rates: Repository<PlatformFxRate>,
  ) {}

  /**
   * Dólar observado (CLP por 1 USD) del día hábil vigente.
   * Cache en BD; si no hay fila fresca, consulta mindicador.cl.
   */
  async getUsdClp() {
    const today = this.todayIso();
    const cached = await this.rates.findOne({
      where: { pair: USD_CLP, rateDate: today },
      order: { fetchedAt: 'DESC' },
    });
    if (cached) {
      return this.serialize(cached);
    }

    // Reutilizar la última tasa conocida del mismo día de indicador
    // (fines de semana / feriados: mindicador suele devolver el hábil previo).
    try {
      const fresh = await this.fetchMindicadorUsd();
      let row = await this.rates.findOne({
        where: { pair: USD_CLP, rateDate: fresh.rateDate },
      });
      if (!row) {
        row = this.rates.create({
          pair: USD_CLP,
          rateDate: fresh.rateDate,
          rate: fresh.rate.toFixed(4),
          source: 'mindicador',
        });
      } else {
        row.rate = fresh.rate.toFixed(4);
        row.source = 'mindicador';
      }
      row = await this.rates.save(row);
      return this.serialize(row);
    } catch (err) {
      this.logger.warn(
        `No se pudo obtener USD/CLP: ${err instanceof Error ? err.message : err}`,
      );
      const last = await this.rates.findOne({
        where: { pair: USD_CLP },
        order: { rateDate: 'DESC' },
      });
      if (last) return { ...this.serialize(last), stale: true as const };
      throw new ServiceUnavailableException(
        'No hay tasa USD/CLP disponible (mindicador.cl)',
      );
    }
  }

  /** Convierte USD → CLP (entero, sin decimales habituales en CLP). */
  async usdToClp(amountUsd: number) {
    const fx = await this.getUsdClp();
    const clp = Math.round(amountUsd * fx.rate);
    return { ...fx, amountUsd, amountClp: clp };
  }

  private async fetchMindicadorUsd(): Promise<{
    rate: number;
    rateDate: string;
  }> {
    const res = await fetch('https://mindicador.cl/api', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      throw new Error(`mindicador HTTP ${res.status}`);
    }
    const data = (await res.json()) as MindicadorRoot;
    const valor = data.dolar?.valor;
    if (valor == null || !Number.isFinite(valor) || valor <= 0) {
      throw new Error('mindicador: dólar sin valor');
    }
    const rateDate = data.dolar?.fecha
      ? data.dolar.fecha.slice(0, 10)
      : this.todayIso();
    return { rate: valor, rateDate };
  }

  private todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  private serialize(row: PlatformFxRate) {
    return {
      pair: row.pair,
      rate: Number(row.rate),
      rateDate: row.rateDate,
      source: row.source,
      fetchedAt: row.fetchedAt,
      stale: false as boolean,
    };
  }
}
