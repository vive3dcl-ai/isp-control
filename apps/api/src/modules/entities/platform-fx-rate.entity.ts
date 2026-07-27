import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/** Tasa FX diaria cacheada (p. ej. USD→CLP desde mindicador.cl). */
@Entity({ name: 'platform_fx_rates', schema: 'public' })
@Unique(['pair', 'rateDate'])
export class PlatformFxRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Ej. USDCLP */
  @Column({ type: 'varchar', length: 16 })
  pair: string;

  /** Fecha del indicador (día hábil del valor). */
  @Column({ name: 'rate_date', type: 'date' })
  rateDate: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  rate: string;

  @Column({ type: 'varchar', length: 40, default: 'mindicador' })
  source: string;

  @CreateDateColumn({ name: 'fetched_at' })
  fetchedAt: Date;
}
