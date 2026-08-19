import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { TenantUser } from '../tenant/entities/tenant-user.entity';
import { Client } from '../crm/entities/client.entity';
import { ServicePlan } from '../crm/entities/service-plan.entity';
import { SpeedProfile } from '../crm/entities/speed-profile.entity';
import { ClientService } from '../crm/entities/client-service.entity';
import { Zone } from '../crm/entities/zone.entity';
import { NetworkDevice } from '../topology/shared/entities/network-device.entity';
import { NetworkPort } from '../topology/shared/entities/network-port.entity';
import { NetworkLink } from '../topology/shared/entities/network-link.entity';
import { NetworkNode } from '../topology/shared/entities/network-node.entity';
import { NodeHeader } from '../topology/shared/entities/node-header.entity';
import { DeviceMetricSample } from '../topology/shared/entities/device-metric-sample.entity';
import { VpnTunnel } from '../topology/shared/entities/vpn-tunnel.entity';
import { VpnTunnelClient } from '../topology/shared/entities/vpn-tunnel-client.entity';
import { Tr069Profile } from '../topology/shared/entities/tr069-profile.entity';
import { Tr069ProfileOlt } from '../topology/shared/entities/tr069-profile-olt.entity';
import { OnuProfile } from '../topology/shared/entities/onu-profile.entity';
import { OnuType } from '../topology/shared/entities/onu-type.entity';
import { Onu } from '../topology/shared/entities/onu.entity';
import { OnuMetricSample } from '../topology/shared/entities/onu-metric-sample.entity';
import { OnuDenied } from '../topology/shared/entities/onu-denied.entity';
import { OnuAcsDriver } from '../topology/shared/entities/onu-acs-driver.entity';
import { OnuFirmwareImage } from '../topology/shared/entities/onu-firmware-image.entity';
import { OltConfigSnapshot } from '../topology/shared/entities/olt-config-snapshot.entity';
import { DeviceAuditEvent } from '../topology/shared/entities/device-audit-event.entity';
import { NetworkAlarm } from '../topology/shared/entities/network-alarm.entity';
import { OnuOrphanSighting } from '../topology/shared/entities/onu-orphan-sighting.entity';
import { IpPool } from '../topology/shared/entities/ip-pool.entity';
import { IpPoolAllocation } from '../topology/shared/entities/ip-pool-allocation.entity';
import { ServiceVlan } from '../topology/shared/entities/service-vlan.entity';
import { BillingSettings } from '../billing/entities/billing-settings.entity';
import { InvoiceTemplate } from '../billing/entities/invoice-template.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { InvoiceItem } from '../billing/entities/invoice-item.entity';
import { BillingProduct } from '../billing/entities/billing-product.entity';
import { ModuleConfig } from '../modules/entities/module-config.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { TvServer } from '../tv/entities/tv-server.entity';

const CRM_DDL = (schema: string) => `
  CREATE TABLE IF NOT EXISTS "${schema}"."clients" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "first_name" varchar(120) NOT NULL DEFAULT '',
    "last_name" varchar(120) NOT NULL DEFAULT '',
    "company_name" varchar(180) NOT NULL DEFAULT '',
    "is_lead" boolean NOT NULL DEFAULT false,
    "email" varchar(255) NOT NULL DEFAULT '',
    "phone" varchar(40) NOT NULL DEFAULT '',
    "street" varchar(180) NOT NULL DEFAULT '',
    "city" varchar(120) NOT NULL DEFAULT '',
    "zip_code" varchar(20) NOT NULL DEFAULT '',
    "note" text NOT NULL DEFAULT '',
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS "${schema}"."service_plans" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" varchar(120) NOT NULL,
    "price" numeric(12,2) NOT NULL DEFAULT 0,
    "invoice_label" varchar(180) NOT NULL DEFAULT '',
    "download_speed" int NOT NULL DEFAULT 0,
    "upload_speed" int NOT NULL DEFAULT 0,
    "speed_profile_id" uuid NULL,
    "invoicing_period" int NOT NULL DEFAULT 1,
    "invoicing_period_type" varchar(20) NOT NULL DEFAULT 'month',
    "billing_anchor" varchar(32) NOT NULL DEFAULT 'installation',
    "billing_cycle_day" varchar(16) NOT NULL DEFAULT 'first',
    "service_types" jsonb NOT NULL DEFAULT '["internet"]',
    "type" varchar(40) NOT NULL DEFAULT 'Internet',
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS "${schema}"."client_services" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "client_id" uuid NOT NULL REFERENCES "${schema}"."clients"("id") ON DELETE CASCADE,
    "service_plan_id" uuid NOT NULL REFERENCES "${schema}"."service_plans"("id") ON DELETE RESTRICT,
    "name" varchar(180) NOT NULL,
    "price" numeric(12,2) NOT NULL DEFAULT 0,
    "active_from" date NULL,
    "active_to" date NULL,
    "status" varchar(20) NOT NULL DEFAULT 'prepared',
    "street" varchar(180) NOT NULL DEFAULT '',
    "city" varchar(120) NOT NULL DEFAULT '',
    "zip_code" varchar(20) NOT NULL DEFAULT '',
    "note" text NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS "idx_client_services_client"
    ON "${schema}"."client_services" ("client_id");
  CREATE INDEX IF NOT EXISTS "idx_client_services_plan"
    ON "${schema}"."client_services" ("service_plan_id");

  -- v28: named download/upload speed profiles (OLT / plans)
  CREATE TABLE IF NOT EXISTS "${schema}"."speed_profiles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" varchar(120) NOT NULL,
    "download_mbps" int NOT NULL DEFAULT 0,
    "upload_mbps" int NOT NULL DEFAULT 0,
    "description" text NOT NULL DEFAULT '',
    "is_active" boolean NOT NULL DEFAULT true,
    "olt_ids" jsonb NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE "${schema}"."speed_profiles"
    ADD COLUMN IF NOT EXISTS "olt_ids" jsonb NOT NULL DEFAULT '[]';

  -- v30: plans linked to system speed profiles (for ONU provisioning later)
  ALTER TABLE "${schema}"."service_plans"
    ADD COLUMN IF NOT EXISTS "speed_profile_id" uuid NULL;
  CREATE INDEX IF NOT EXISTS "idx_service_plans_speed_profile"
    ON "${schema}"."service_plans" ("speed_profile_id");

  -- v31: monthly billing anchors + multi service types
  ALTER TABLE "${schema}"."service_plans"
    ADD COLUMN IF NOT EXISTS "billing_anchor" varchar(32) NOT NULL DEFAULT 'installation';
  ALTER TABLE "${schema}"."service_plans"
    ADD COLUMN IF NOT EXISTS "billing_cycle_day" varchar(16) NOT NULL DEFAULT 'first';
  ALTER TABLE "${schema}"."service_plans"
    ADD COLUMN IF NOT EXISTS "service_types" jsonb NOT NULL DEFAULT '["internet"]';

  -- v32: installation fee + billing (invoices, templates, crons, periods)
  ALTER TABLE "${schema}"."service_plans"
    ADD COLUMN IF NOT EXISTS "installation_fee" numeric(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE "${schema}"."service_plans"
    ADD COLUMN IF NOT EXISTS "installation_fee_on_first_invoice" boolean NOT NULL DEFAULT true;

  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "period_start" date NULL;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "period_end" date NULL;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "next_billing_date" date NULL;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "installation_fee_pending" boolean NOT NULL DEFAULT false;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "installation_invoiced" boolean NOT NULL DEFAULT false;

  -- v33: link services to a provisioned ONU + install geolocation
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "onu_id" uuid NULL;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "latitude" double precision NULL;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "longitude" double precision NULL;
  CREATE INDEX IF NOT EXISTS "idx_client_services_onu"
    ON "${schema}"."client_services" ("onu_id");

  -- v34: client geolocation (same UX as service install address)
  ALTER TABLE "${schema}"."clients"
    ADD COLUMN IF NOT EXISTS "latitude" double precision NULL;
  ALTER TABLE "${schema}"."clients"
    ADD COLUMN IF NOT EXISTS "longitude" double precision NULL;

  -- v35: per-tenant module configs (SMTP, future paid modules)
  CREATE TABLE IF NOT EXISTS "${schema}"."module_configs" (
    "module_id" varchar(64) PRIMARY KEY,
    "config" jsonb NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- v36: client identity document (per tenant country) + company client mode
  ALTER TABLE "${schema}"."clients"
    ADD COLUMN IF NOT EXISTS "document_type" varchar(20) NOT NULL DEFAULT '';
  ALTER TABLE "${schema}"."clients"
    ADD COLUMN IF NOT EXISTS "document_number" varchar(40) NOT NULL DEFAULT '';
  ALTER TABLE "${schema}"."clients"
    ADD COLUMN IF NOT EXISTS "is_company" boolean NOT NULL DEFAULT false;
  ALTER TABLE "${schema}"."clients"
    ADD COLUMN IF NOT EXISTS "company_tax_id" varchar(40) NOT NULL DEFAULT '';

  CREATE TABLE IF NOT EXISTS "${schema}"."billing_settings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "timezone" varchar(64) NOT NULL DEFAULT 'America/Santiago',
    "invoice_prefix" varchar(20) NOT NULL DEFAULT 'F',
    "next_invoice_number" int NOT NULL DEFAULT 1,
    "periods_enabled" boolean NOT NULL DEFAULT true,
    "periods_cron" varchar(64) NOT NULL DEFAULT '5 0 * * *',
    "periods_last_run_at" TIMESTAMPTZ NULL,
    "generate_enabled" boolean NOT NULL DEFAULT true,
    "generate_cron" varchar(64) NOT NULL DEFAULT '0 6 * * *',
    "generate_last_run_at" TIMESTAMPTZ NULL,
    "send_enabled" boolean NOT NULL DEFAULT true,
    "send_cron" varchar(64) NOT NULL DEFAULT '0 8 * * *',
    "send_last_run_at" TIMESTAMPTZ NULL,
    "default_due_days" int NOT NULL DEFAULT 10,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS "${schema}"."invoice_templates" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" varchar(32) NOT NULL,
    "name" varchar(120) NOT NULL,
    "subject" varchar(255) NOT NULL DEFAULT '',
    "body_html" text NOT NULL DEFAULT '',
    "is_default" boolean NOT NULL DEFAULT false,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "idx_invoice_templates_type"
    ON "${schema}"."invoice_templates" ("type");

  CREATE TABLE IF NOT EXISTS "${schema}"."invoices" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "number" varchar(40) NOT NULL,
    "client_id" uuid NOT NULL REFERENCES "${schema}"."clients"("id") ON DELETE RESTRICT,
    "client_service_id" uuid NULL REFERENCES "${schema}"."client_services"("id") ON DELETE SET NULL,
    "type" varchar(32) NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'draft',
    "currency" varchar(3) NOT NULL DEFAULT 'USD',
    "subtotal" numeric(12,2) NOT NULL DEFAULT 0,
    "tax" numeric(12,2) NOT NULL DEFAULT 0,
    "total" numeric(12,2) NOT NULL DEFAULT 0,
    "period_start" date NULL,
    "period_end" date NULL,
    "issue_date" date NOT NULL,
    "due_date" date NULL,
    "sent_at" TIMESTAMPTZ NULL,
    "notes" text NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoices_number"
    ON "${schema}"."invoices" ("number");
  CREATE INDEX IF NOT EXISTS "idx_invoices_client"
    ON "${schema}"."invoices" ("client_id");
  CREATE INDEX IF NOT EXISTS "idx_invoices_status"
    ON "${schema}"."invoices" ("status");

  CREATE TABLE IF NOT EXISTS "${schema}"."invoice_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "invoice_id" uuid NOT NULL REFERENCES "${schema}"."invoices"("id") ON DELETE CASCADE,
    "description" varchar(255) NOT NULL,
    "quantity" numeric(12,4) NOT NULL DEFAULT 1,
    "unit_price" numeric(12,2) NOT NULL DEFAULT 0,
    "amount" numeric(12,2) NOT NULL DEFAULT 0,
    "sort_order" int NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS "idx_invoice_items_invoice"
    ON "${schema}"."invoice_items" ("invoice_id");

  -- v40: catálogo de productos para facturas manuales
  CREATE TABLE IF NOT EXISTS "${schema}"."billing_products" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" varchar(180) NOT NULL,
    "description" text NOT NULL DEFAULT '',
    "unit_price" numeric(12,2) NOT NULL DEFAULT 0,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "idx_billing_products_active"
    ON "${schema}"."billing_products" ("is_active");

  CREATE TABLE IF NOT EXISTS "${schema}"."calendar_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" varchar(32) NOT NULL,
    "title" varchar(200) NOT NULL,
    "notes" text NOT NULL DEFAULT '',
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "all_day" boolean NOT NULL DEFAULT false,
    "status" varchar(20) NOT NULL DEFAULT 'scheduled',
    "client_id" uuid NULL REFERENCES "${schema}"."clients"("id") ON DELETE SET NULL,
    "assigned_user_id" uuid NULL REFERENCES "${schema}"."users"("id") ON DELETE SET NULL,
    "address" varchar(255) NOT NULL DEFAULT '',
    "created_by" uuid NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "idx_calendar_events_starts"
    ON "${schema}"."calendar_events" ("starts_at");
  CREATE INDEX IF NOT EXISTS "idx_calendar_events_type"
    ON "${schema}"."calendar_events" ("type");
  CREATE INDEX IF NOT EXISTS "idx_calendar_events_status"
    ON "${schema}"."calendar_events" ("status");
`;

const TOPOLOGY_DDL = (schema: string) => `
  CREATE TABLE IF NOT EXISTS "${schema}"."network_devices" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" varchar(120) NOT NULL,
    "type" varchar(40) NOT NULL,
    "note" text NOT NULL DEFAULT '',
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS "${schema}"."network_ports" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "device_id" uuid NOT NULL REFERENCES "${schema}"."network_devices"("id") ON DELETE CASCADE,
    "name" varchar(80) NOT NULL,
    "ip_address" varchar(64) NULL,
    "sort_order" int NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS "idx_network_ports_device"
    ON "${schema}"."network_ports" ("device_id");

  CREATE TABLE IF NOT EXISTS "${schema}"."network_links" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "port_a_id" uuid NOT NULL UNIQUE REFERENCES "${schema}"."network_ports"("id") ON DELETE CASCADE,
    "port_b_id" uuid NOT NULL UNIQUE REFERENCES "${schema}"."network_ports"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "chk_network_links_distinct"
      CHECK ("port_a_id" <> "port_b_id")
  );
`;

/** Additive columns for existing tenant schemas (IF NOT EXISTS). */
const TOPOLOGY_ALTER = (schema: string) => `
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "subtype" varchar(40) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "mgmt_host" varchar(255) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "mgmt_port" int NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "mgmt_username" varchar(120) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "mgmt_password" text NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "mgmt_protocol" varchar(40) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "connection_status" varchar(20) NOT NULL DEFAULT 'unknown';
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "last_checked_at" TIMESTAMPTZ NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "last_error" text NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "metric_cpu_load" int NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "metric_free_memory" bigint NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "metric_total_memory" bigint NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "metric_uptime" varchar(80) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "metric_identity" varchar(120) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "metric_version" varchar(80) NULL;
  ALTER TABLE "${schema}"."network_ports"
    ADD COLUMN IF NOT EXISTS "link_status" varchar(20) NOT NULL DEFAULT 'unknown';
  ALTER TABLE "${schema}"."network_ports"
    ADD COLUMN IF NOT EXISTS "is_synced" boolean NOT NULL DEFAULT false;
  ALTER TABLE "${schema}"."network_ports"
    ADD COLUMN IF NOT EXISTS "vlans" jsonb NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE "${schema}"."network_ports"
    ADD COLUMN IF NOT EXISTS "ip_addresses" jsonb NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE "${schema}"."network_ports"
    ADD COLUMN IF NOT EXISTS "default_name" varchar(80) NULL;
  ALTER TABLE "${schema}"."network_ports"
    ADD COLUMN IF NOT EXISTS "mac_address" varchar(32) NULL;
  ALTER TABLE "${schema}"."network_ports"
    ADD COLUMN IF NOT EXISTS "comment" text NOT NULL DEFAULT '';
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "metric_board_name" varchar(120) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "metric_temperature" double precision NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "mgmt_connection_mode" varchar(20) NOT NULL DEFAULT 'public';
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "mgmt_enable_password" text NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "snmp_community" varchar(120) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "snmp_community_rw" varchar(120) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "snmp_port" int NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "pon_type" varchar(20) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "metric_summary" varchar(255) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "olt_vlan_meta" jsonb NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "olt_inventory_cache" jsonb NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "onus_import_prompted_at" TIMESTAMPTZ NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "internet_egress_port_name" varchar(80) NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "internet_egress_vlan_id" int NULL;
  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "technician_mode" boolean NOT NULL DEFAULT false;

  CREATE TABLE IF NOT EXISTS "${schema}"."olt_config_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "olt_id" uuid NOT NULL REFERENCES "${schema}"."network_devices"("id") ON DELETE CASCADE,
    "source" varchar(16) NOT NULL,
    "byte_size" int NOT NULL DEFAULT 0,
    "sha256" varchar(64) NOT NULL DEFAULT '',
    "complete" boolean NOT NULL DEFAULT false,
    "file_name" varchar(255) NOT NULL,
    "note" text NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "idx_olt_config_snapshots_olt_time"
    ON "${schema}"."olt_config_snapshots" ("olt_id", "created_at" DESC);

  CREATE TABLE IF NOT EXISTS "${schema}"."device_metric_samples" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "device_id" uuid NOT NULL REFERENCES "${schema}"."network_devices"("id") ON DELETE CASCADE,
    "sampled_at" TIMESTAMPTZ NOT NULL,
    "cpu_load" int NULL,
    "memory_used_pct" double precision NULL,
    "temperature" double precision NULL,
    "uptime_seconds" bigint NULL,
    "rx_bytes" bigint NULL,
    "tx_bytes" bigint NULL,
    "rx_bps" double precision NULL,
    "tx_bps" double precision NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE "${schema}"."device_metric_samples"
    ADD COLUMN IF NOT EXISTS "rx_bytes" bigint NULL;
  ALTER TABLE "${schema}"."device_metric_samples"
    ADD COLUMN IF NOT EXISTS "tx_bytes" bigint NULL;
  ALTER TABLE "${schema}"."device_metric_samples"
    ADD COLUMN IF NOT EXISTS "rx_bps" double precision NULL;
  ALTER TABLE "${schema}"."device_metric_samples"
    ADD COLUMN IF NOT EXISTS "tx_bps" double precision NULL;
  CREATE INDEX IF NOT EXISTS "idx_device_metric_samples_device_time"
    ON "${schema}"."device_metric_samples" ("device_id", "sampled_at");

  CREATE TABLE IF NOT EXISTS "${schema}"."vpn_tunnels" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" varchar(80) NOT NULL,
    "protocol" varchar(20) NOT NULL,
    "mode" varchar(20) NOT NULL DEFAULT 'outbound',
    "endpoint_host" varchar(255) NULL,
    "tunnel_subnet" varchar(64) NOT NULL,
    "client_address" varchar(64) NOT NULL,
    "server_address" varchar(64) NOT NULL,
    "password" text NULL,
    "wg_private_key" text NULL,
    "wg_public_key" text NULL,
    "tunnel_routes" text NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'pending',
    "setup_token" varchar(64) NULL,
    "setup_token_expires_at" TIMESTAMPTZ NULL,
    "last_imported_device_id" uuid NULL,
    "last_imported_at" TIMESTAMPTZ NULL,
    "note" text NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_vpn_tunnels_name" UNIQUE ("name")
  );
  CREATE INDEX IF NOT EXISTS "idx_vpn_tunnels_setup_token"
    ON "${schema}"."vpn_tunnels" ("setup_token");
  ALTER TABLE "${schema}"."vpn_tunnels"
    ADD COLUMN IF NOT EXISTS "mode" varchar(20) NOT NULL DEFAULT 'outbound';
  ALTER TABLE "${schema}"."vpn_tunnels"
    ADD COLUMN IF NOT EXISTS "endpoint_host" varchar(255) NULL;

  -- Multi-cliente por segmento VPN (mismo /24: .2, .3, .4…)
  CREATE TABLE IF NOT EXISTS "${schema}"."vpn_tunnel_clients" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tunnel_id" uuid NOT NULL REFERENCES "${schema}"."vpn_tunnels"("id") ON DELETE CASCADE,
    "name" varchar(80) NOT NULL,
    "client_address" varchar(64) NOT NULL,
    "password" text NULL,
    "wg_private_key" text NULL,
    "wg_public_key" text NULL,
    "device_id" uuid NULL,
    "imported_at" TIMESTAMPTZ NULL,
    "status" varchar(20) NOT NULL DEFAULT 'pending',
    "setup_token" varchar(64) NULL,
    "setup_token_expires_at" TIMESTAMPTZ NULL,
    "note" text NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_vpn_tunnel_clients_name" UNIQUE ("name"),
    CONSTRAINT "uq_vpn_tunnel_clients_addr" UNIQUE ("tunnel_id", "client_address")
  );
  CREATE INDEX IF NOT EXISTS "idx_vpn_tunnel_clients_tunnel"
    ON "${schema}"."vpn_tunnel_clients" ("tunnel_id");
  CREATE UNIQUE INDEX IF NOT EXISTS "uq_vpn_tunnel_clients_device"
    ON "${schema}"."vpn_tunnel_clients" ("device_id")
    WHERE "device_id" IS NOT NULL;
  CREATE INDEX IF NOT EXISTS "idx_vpn_tunnel_clients_setup_token"
    ON "${schema}"."vpn_tunnel_clients" ("setup_token");
  -- Backfill: un cliente primario por túnel legado (misma IP/credenciales)
  INSERT INTO "${schema}"."vpn_tunnel_clients" (
    "tunnel_id", "name", "client_address", "password",
    "wg_private_key", "wg_public_key", "device_id", "imported_at", "status"
  )
  SELECT
    t."id", t."name", t."client_address", t."password",
    t."wg_private_key", t."wg_public_key",
    t."last_imported_device_id", t."last_imported_at",
    COALESCE(t."status", 'pending')
  FROM "${schema}"."vpn_tunnels" t
  WHERE NOT EXISTS (
    SELECT 1 FROM "${schema}"."vpn_tunnel_clients" c WHERE c."tunnel_id" = t."id"
  )
  ON CONFLICT ("name") DO NOTHING;

  CREATE TABLE IF NOT EXISTS "${schema}"."tr069_profiles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" varchar(120) NOT NULL,
    "acs_url" varchar(255) NOT NULL,
    "acs_port" int NOT NULL DEFAULT 14501,
    "acs_username" varchar(120) NOT NULL,
    "acs_password" varchar(120) NOT NULL,
    "connection_request_username" varchar(120) NOT NULL,
    "connection_request_password" varchar(120) NOT NULL,
    "periodic_inform_enable" boolean NOT NULL DEFAULT true,
    "periodic_inform_interval" int NOT NULL DEFAULT 300,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_tr069_profiles_name" UNIQUE ("name")
  );

  CREATE TABLE IF NOT EXISTS "${schema}"."tr069_profile_olts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "profile_id" uuid NOT NULL REFERENCES "${schema}"."tr069_profiles"("id") ON DELETE CASCADE,
    "device_id" uuid NOT NULL REFERENCES "${schema}"."network_devices"("id") ON DELETE CASCADE,
    CONSTRAINT "uq_tr069_profile_olts" UNIQUE ("profile_id", "device_id")
  );
  CREATE INDEX IF NOT EXISTS "idx_tr069_profile_olts_device"
    ON "${schema}"."tr069_profile_olts" ("device_id");

  CREATE TABLE IF NOT EXISTS "${schema}"."onu_profiles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" varchar(40) NOT NULL,
    "name" varchar(80) NOT NULL,
    "description" text NOT NULL DEFAULT '',
    "vlan_cli" varchar(255) NOT NULL,
    "port_kind" varchar(20) NOT NULL DEFAULT 'eth',
    "sort_order" int NOT NULL DEFAULT 0,
    "is_system" boolean NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_onu_profiles_code" UNIQUE ("code")
  );

  CREATE TABLE IF NOT EXISTS "${schema}"."onu_types" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "pon_type" varchar(20) NOT NULL,
    "channel" varchar(8) NOT NULL DEFAULT 'G',
    "channel_gpon" boolean NOT NULL DEFAULT true,
    "channel_xgpon" boolean NOT NULL DEFAULT false,
    "channel_xgspon" boolean NOT NULL DEFAULT false,
    "name" varchar(80) NOT NULL,
    "vendor" varchar(40) NOT NULL DEFAULT 'other',
    "from_catalog" boolean NOT NULL DEFAULT false,
    "listed" boolean NOT NULL DEFAULT false,
    "ethernet_ports" int NOT NULL DEFAULT 1,
    "wifi_ssids" int NOT NULL DEFAULT 0,
    "voip_ports" int NOT NULL DEFAULT 0,
    "catv" boolean NOT NULL DEFAULT false,
    "allow_custom_profiles" boolean NOT NULL DEFAULT true,
    "default_profile_id" uuid NULL REFERENCES "${schema}"."onu_profiles"("id") ON DELETE SET NULL,
    "capability" varchar(40) NOT NULL DEFAULT 'bridging_routing',
    "use_default_image" boolean NOT NULL DEFAULT true,
    "image_url" text NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_onu_types_name" UNIQUE ("name")
  );
  ALTER TABLE "${schema}"."onu_types"
    ADD COLUMN IF NOT EXISTS "vendor" varchar(40) NOT NULL DEFAULT 'other';
  ALTER TABLE "${schema}"."onu_types"
    ADD COLUMN IF NOT EXISTS "from_catalog" boolean NOT NULL DEFAULT false;
  ALTER TABLE "${schema}"."onu_types"
    ADD COLUMN IF NOT EXISTS "listed" boolean NOT NULL DEFAULT false;
  UPDATE "${schema}"."onu_types" SET "listed" = true WHERE "from_catalog" = false;

  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "onus_import_prompted_at" TIMESTAMPTZ NULL;

  CREATE TABLE IF NOT EXISTS "${schema}"."onus" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "olt_id" uuid NOT NULL REFERENCES "${schema}"."network_devices"("id") ON DELETE CASCADE,
    "onu_if" varchar(80) NOT NULL,
    "pon_type" varchar(20) NOT NULL DEFAULT 'gpon',
    "board" varchar(20) NOT NULL DEFAULT '',
    "port" varchar(20) NOT NULL DEFAULT '',
    "onu_id" varchar(20) NOT NULL DEFAULT '',
    "sn" varchar(40) NULL,
    "onu_type" varchar(80) NULL,
    "name" varchar(160) NULL,
    "description" text NOT NULL DEFAULT '',
    "status" varchar(40) NOT NULL DEFAULT 'other',
    "phase_state" varchar(40) NOT NULL DEFAULT '',
    "admin_state" varchar(40) NOT NULL DEFAULT '',
    "online" boolean NOT NULL DEFAULT false,
    "signal_dbm" double precision NULL,
    "mode" varchar(20) NULL,
    "vlan" int NULL,
    "vlans" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "zone" varchar(120) NULL,
    "odb" varchar(120) NULL,
    "voip" varchar(80) NULL,
    "tv" varchar(80) NULL,
    "auth_date" TIMESTAMPTZ NULL,
    "last_probed_at" TIMESTAMPTZ NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_onus_olt_if" UNIQUE ("olt_id", "onu_if")
  );
  CREATE INDEX IF NOT EXISTS "idx_onus_olt" ON "${schema}"."onus" ("olt_id");
  CREATE INDEX IF NOT EXISTS "idx_onus_sn" ON "${schema}"."onus" ("sn");
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "online_since" TIMESTAMPTZ NULL;
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "if_index" int NULL;
  ALTER TABLE "${schema}"."onus"
    ALTER COLUMN "if_index" TYPE bigint USING "if_index"::bigint;

  CREATE TABLE IF NOT EXISTS "${schema}"."onu_metric_samples" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "onu_id" uuid NOT NULL REFERENCES "${schema}"."onus"("id") ON DELETE CASCADE,
    "kind" varchar(20) NOT NULL,
    "value" double precision NOT NULL,
    "sampled_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "idx_onu_metric_samples_onu_kind_time"
    ON "${schema}"."onu_metric_samples" ("onu_id", "kind", "sampled_at");

  CREATE TABLE IF NOT EXISTS "${schema}"."onu_denied" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "sn" varchar(40) NOT NULL,
    "olt_id" uuid NULL,
    "olt_if" varchar(80) NULL,
    "olt_name" varchar(120) NULL,
    "board" varchar(20) NULL,
    "port" varchar(20) NULL,
    "pon_type" varchar(20) NULL,
    "note" text NULL,
    "manual" boolean NOT NULL DEFAULT true,
    "denied_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_onu_denied_sn" UNIQUE ("sn")
  );
  CREATE INDEX IF NOT EXISTS "idx_onu_denied_sn" ON "${schema}"."onu_denied" ("sn");

  CREATE TABLE IF NOT EXISTS "${schema}"."onu_acs_drivers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "model_key" varchar(80) NOT NULL,
    "family" varchar(32) NOT NULL,
    "library_id" varchar(80) NULL,
    "wan_path" varchar(255) NULL,
    "vlan_leaf" varchar(255) NULL,
    "bind_leaf" varchar(255) NULL,
    "spv" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "playbook" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "faults_skip" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "source" varchar(16) NOT NULL DEFAULT 'seed',
    "enabled" boolean NOT NULL DEFAULT true,
    "success_count" int NOT NULL DEFAULT 0,
    "learned_from_sn" varchar(40) NULL,
    "needs_reboot_after_creds" boolean NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_onu_acs_drivers_model" UNIQUE ("model_key")
  );
  CREATE INDEX IF NOT EXISTS "idx_onu_acs_drivers_family"
    ON "${schema}"."onu_acs_drivers" ("family");

  CREATE TABLE IF NOT EXISTS "${schema}"."onu_firmware_images" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "model_key" varchar(80) NOT NULL,
    "version" varchar(80) NOT NULL,
    "file_name" varchar(255) NOT NULL,
    "file_path" varchar(500) NOT NULL,
    "byte_size" bigint NOT NULL DEFAULT 0,
    "genie_file_id" varchar(255) NULL,
    "note" text NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "idx_onu_firmware_images_model"
    ON "${schema}"."onu_firmware_images" ("model_key");

  CREATE TABLE IF NOT EXISTS "${schema}"."device_audit_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "actor_id" varchar(80) NULL,
    "actor_email" varchar(160) NULL,
    "actor_kind" varchar(16) NOT NULL DEFAULT 'user',
    "action" varchar(40) NOT NULL,
    "ok" boolean NOT NULL DEFAULT true,
    "duration_ms" int NOT NULL DEFAULT 0,
    "sn" varchar(40) NULL,
    "onu_id" uuid NULL,
    "olt_id" uuid NULL,
    "onu_if" varchar(80) NULL,
    "detail" jsonb NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE INDEX IF NOT EXISTS "idx_device_audit_sn_time"
    ON "${schema}"."device_audit_events" ("sn", "occurred_at" DESC);
  CREATE INDEX IF NOT EXISTS "idx_device_audit_olt_time"
    ON "${schema}"."device_audit_events" ("olt_id", "occurred_at" DESC);
  CREATE INDEX IF NOT EXISTS "idx_device_audit_onu_time"
    ON "${schema}"."device_audit_events" ("onu_id", "occurred_at" DESC);
  CREATE TABLE IF NOT EXISTS "${schema}"."network_alarms" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "kind" varchar(32) NOT NULL,
    "onu_id" uuid NULL,
    "sn" varchar(40) NULL,
    "olt_id" uuid NULL,
    "status" varchar(12) NOT NULL DEFAULT 'open',
    "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "cleared_at" TIMESTAMPTZ NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "idx_network_alarms_status"
    ON "${schema}"."network_alarms" ("status");
  CREATE INDEX IF NOT EXISTS "idx_network_alarms_onu"
    ON "${schema}"."network_alarms" ("onu_id");
  CREATE UNIQUE INDEX IF NOT EXISTS "uq_network_alarms_open_kind_onu"
    ON "${schema}"."network_alarms" ("kind", "onu_id")
    WHERE "status" = 'open';




  CREATE TABLE IF NOT EXISTS "${schema}"."ip_pools" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "olt_id" uuid NOT NULL REFERENCES "${schema}"."network_devices"("id") ON DELETE CASCADE,
    "vlan_id" int NOT NULL,
    "purpose" varchar(20) NOT NULL,
    "name" varchar(120) NULL,
    "gateway" varchar(45) NOT NULL,
    "prefix" int NOT NULL,
    "network" varchar(45) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_ip_pools_olt_vlan_purpose" UNIQUE ("olt_id", "vlan_id", "purpose")
  );
  CREATE INDEX IF NOT EXISTS "idx_ip_pools_olt" ON "${schema}"."ip_pools" ("olt_id");
  CREATE INDEX IF NOT EXISTS "idx_ip_pools_purpose" ON "${schema}"."ip_pools" ("purpose");

  CREATE TABLE IF NOT EXISTS "${schema}"."ip_pool_allocations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "pool_id" uuid NOT NULL REFERENCES "${schema}"."ip_pools"("id") ON DELETE CASCADE,
    "ip_address" varchar(45) NOT NULL,
    "onu_id" uuid NULL REFERENCES "${schema}"."onus"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_ip_pool_allocations_pool_ip" UNIQUE ("pool_id", "ip_address")
  );
  CREATE INDEX IF NOT EXISTS "idx_ip_pool_allocations_pool"
    ON "${schema}"."ip_pool_allocations" ("pool_id");
  CREATE INDEX IF NOT EXISTS "idx_ip_pool_allocations_onu"
    ON "${schema}"."ip_pool_allocations" ("onu_id");

  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "mgmt_ip" varchar(45) NULL;
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "mgmt_pool_id" uuid NULL;
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "tr069_profile_id" uuid NULL;

  -- v23: one management allocation per ONU (keep current onus.mgmt_ip, else newest)
  DELETE FROM "${schema}"."ip_pool_allocations" a
  USING "${schema}"."ip_pool_allocations" b
  WHERE a.onu_id IS NOT NULL
    AND a.onu_id = b.onu_id
    AND a.pool_id = b.pool_id
    AND a.id <> b.id
    AND (
      a.created_at < b.created_at
      OR (a.created_at = b.created_at AND a.id::text < b.id::text)
    )
    AND NOT EXISTS (
      SELECT 1 FROM "${schema}"."onus" o
      WHERE o.id = a.onu_id AND o.mgmt_ip = a.ip_address
    );
  DELETE FROM "${schema}"."ip_pool_allocations" a
  USING "${schema}"."ip_pool_allocations" b, "${schema}"."onus" o
  WHERE a.onu_id = o.id
    AND b.onu_id = o.id
    AND a.pool_id = b.pool_id
    AND a.id <> b.id
    AND o.mgmt_ip = b.ip_address
    AND a.ip_address <> o.mgmt_ip;
  CREATE UNIQUE INDEX IF NOT EXISTS "uq_ip_pool_allocations_pool_onu"
    ON "${schema}"."ip_pool_allocations" ("pool_id", "onu_id")
    WHERE "onu_id" IS NOT NULL;

  -- v41: liberar IPs huérfanas y CASCADE al borrar ONU (antes SET NULL las dejaba ocupadas)
  DELETE FROM "${schema}"."ip_pool_allocations" WHERE "onu_id" IS NULL;
  DELETE FROM "${schema}"."ip_pool_allocations" a
  WHERE a."onu_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "${schema}"."onus" o WHERE o."id" = a."onu_id"
    );
  DO $mig$
  BEGIN
    ALTER TABLE "${schema}"."ip_pool_allocations"
      DROP CONSTRAINT IF EXISTS "ip_pool_allocations_onu_id_fkey";
    ALTER TABLE "${schema}"."ip_pool_allocations"
      ADD CONSTRAINT "ip_pool_allocations_onu_id_fkey"
      FOREIGN KEY ("onu_id") REFERENCES "${schema}"."onus"("id")
      ON DELETE CASCADE;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END
  $mig$;

  ALTER TABLE "${schema}"."ip_pools"
    ADD COLUMN IF NOT EXISTS "dns1" varchar(45) NULL;
  ALTER TABLE "${schema}"."ip_pools"
    ADD COLUMN IF NOT EXISTS "dns2" varchar(45) NULL;
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "wan_ip" varchar(45) NULL;
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "wan_pool_id" uuid NULL;

  ALTER TABLE "${schema}"."ip_pools"
    ADD COLUMN IF NOT EXISTS "router_id" uuid NULL;

  -- v27: provisioning mode (auto/manual) for ONUs
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "provision_mode" varchar(12) NOT NULL DEFAULT 'auto';

  CREATE TABLE IF NOT EXISTS "${schema}"."service_vlans" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "vlan_id" int NOT NULL,
    "description" varchar(255) NULL,
    "olt_ids" jsonb NOT NULL DEFAULT '[]',
    "router_ids" jsonb NOT NULL DEFAULT '[]',
    "switch_ids" jsonb NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_service_vlans_vlan_id" UNIQUE ("vlan_id")
  );
  ALTER TABLE "${schema}"."service_vlans"
    ADD COLUMN IF NOT EXISTS "switch_ids" jsonb NOT NULL DEFAULT '[]';

  -- v36: physical network nodes (sites) + device assignment
  CREATE TABLE IF NOT EXISTS "${schema}"."network_nodes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" varchar(160) NOT NULL,
    "note" text NOT NULL DEFAULT '',
    "is_rented" boolean NOT NULL DEFAULT false,
    "contact_name" varchar(160) NOT NULL DEFAULT '',
    "contact_phone" varchar(40) NOT NULL DEFAULT '',
    "contact_email" varchar(255) NOT NULL DEFAULT '',
    "street" varchar(180) NOT NULL DEFAULT '',
    "city" varchar(120) NOT NULL DEFAULT '',
    "zip_code" varchar(20) NOT NULL DEFAULT '',
    "latitude" double precision NULL,
    "longitude" double precision NULL,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "idx_network_nodes_active"
    ON "${schema}"."network_nodes" ("is_active");

  ALTER TABLE "${schema}"."network_devices"
    ADD COLUMN IF NOT EXISTS "node_id" uuid NULL;
  CREATE INDEX IF NOT EXISTS "idx_network_devices_node"
    ON "${schema}"."network_devices" ("node_id");

  -- v37: zonas CRM (catálogo; perímetro del mapa es aparte)
  CREATE TABLE IF NOT EXISTS "${schema}"."zones" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" varchar(160) NOT NULL,
    "description" text NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "idx_zones_name"
    ON "${schema}"."zones" ("name");

  ALTER TABLE "${schema}"."clients"
    ADD COLUMN IF NOT EXISTS "zone_id" uuid NULL;
  CREATE INDEX IF NOT EXISTS "idx_clients_zone"
    ON "${schema}"."clients" ("zone_id");

  -- v38: ONUs vinculadas al catálogo de zonas CRM
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "zone_id" uuid NULL;
  CREATE INDEX IF NOT EXISTS "idx_onus_zone"
    ON "${schema}"."onus" ("zone_id");

  -- v39: cabeceras de fibra (ODF) por nodo físico
  CREATE TABLE IF NOT EXISTS "${schema}"."node_headers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "node_id" uuid NOT NULL,
    "name" varchar(160) NOT NULL,
    "description" text NOT NULL DEFAULT '',
    "port_count" int NOT NULL DEFAULT 8,
    "ports" jsonb NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "idx_node_headers_node"
    ON "${schema}"."node_headers" ("node_id");

  -- v46: chequeo silencioso post-aprovisionamiento WAN
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "verify_status" varchar(12) NOT NULL DEFAULT 'idle';
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "verify_started_at" TIMESTAMPTZ NULL;
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "verify_checked_at" TIMESTAMPTZ NULL;
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "verify_attempt" int NOT NULL DEFAULT 0;
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "verify_detail" jsonb NOT NULL DEFAULT '{}'::jsonb;
  CREATE INDEX IF NOT EXISTS "idx_onus_verify_status"
    ON "${schema}"."onus" ("verify_status");

  -- v47: progreso persistente del asistente de migración
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "migration_source_vlan" int NULL;
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "migrated_at" TIMESTAMPTZ NULL;
  CREATE INDEX IF NOT EXISTS "idx_onus_migration_progress"
    ON "${schema}"."onus" ("olt_id", "migration_source_vlan", "migrated_at");

  -- v48: tipo semántico de VLAN de servicio (Internet / Mgmt / TV)
  ALTER TABLE "${schema}"."service_vlans"
    ADD COLUMN IF NOT EXISTS "purpose" varchar(20) NOT NULL DEFAULT 'internet';
  CREATE INDEX IF NOT EXISTS "idx_service_vlans_purpose"
    ON "${schema}"."service_vlans" ("purpose");

  -- v50: modo IGMP MVLAN por VLAN TV (snooping|spr|proxy|router)
  ALTER TABLE "${schema}"."service_vlans"
    ADD COLUMN IF NOT EXISTS "igmp_work_mode" varchar(20) NULL;

  -- v51: host-ip IGMP proxy (solo modo proxy)
  ALTER TABLE "${schema}"."service_vlans"
    ADD COLUMN IF NOT EXISTS "igmp_host_ip" varchar(45) NULL;

  -- v52: source-port IGMP por OLT (mapa oltId → ifNames[])
  ALTER TABLE "${schema}"."service_vlans"
    ADD COLUMN IF NOT EXISTS "igmp_source_ports" jsonb NOT NULL DEFAULT '{}';

  -- v49: inventario ONU/deco + TV en planes / snapshot en servicios
  CREATE TABLE IF NOT EXISTS "${schema}"."inventory_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" varchar(16) NOT NULL,
    "brand" varchar(80) NOT NULL,
    "model" varchar(120) NOT NULL,
    "quantity" int NOT NULL DEFAULT 0,
    "notes" text NOT NULL DEFAULT '',
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_items_type_brand_model"
    ON "${schema}"."inventory_items" ("type", lower("brand"), lower("model"));
  CREATE INDEX IF NOT EXISTS "idx_inventory_items_type"
    ON "${schema}"."inventory_items" ("type");

  ALTER TABLE "${schema}"."service_plans"
    ADD COLUMN IF NOT EXISTS "deco_count" int NOT NULL DEFAULT 0;
  ALTER TABLE "${schema}"."service_plans"
    ADD COLUMN IF NOT EXISTS "additional_deco_price" numeric(12,2) NOT NULL DEFAULT 0;

  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "inventory_onu_item_id" uuid NULL;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "inventory_deco_item_id" uuid NULL;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "included_deco_count" int NOT NULL DEFAULT 0;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "additional_deco_count" int NOT NULL DEFAULT 0;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "additional_deco_fee_pending" boolean NOT NULL DEFAULT false;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "additional_deco_unit_price" numeric(12,2) NOT NULL DEFAULT 0;

  -- v50: flags de migración en cliente/servicio + sync one-shot de nombre ONU
  ALTER TABLE "${schema}"."clients"
    ADD COLUMN IF NOT EXISTS "migrated_at" TIMESTAMPTZ NULL;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "migrated_at" TIMESTAMPTZ NULL;
  ALTER TABLE "${schema}"."client_services"
    ADD COLUMN IF NOT EXISTS "onu_name_synced_at" TIMESTAMPTZ NULL;
  CREATE INDEX IF NOT EXISTS "idx_clients_migrated_at"
    ON "${schema}"."clients" ("migrated_at")
    WHERE "migrated_at" IS NOT NULL;
  CREATE INDEX IF NOT EXISTS "idx_client_services_migrated_at"
    ON "${schema}"."client_services" ("migrated_at")
    WHERE "migrated_at" IS NOT NULL;
  -- Backfill: ONUs ya migradas → marcar servicio y cliente
  UPDATE "${schema}"."client_services" AS cs
  SET "migrated_at" = o."migrated_at"
  FROM "${schema}"."onus" AS o
  WHERE cs."onu_id" = o."id"
    AND o."migrated_at" IS NOT NULL
    AND cs."migrated_at" IS NULL;
  UPDATE "${schema}"."clients" AS c
  SET "migrated_at" = sub."m"
  FROM (
    SELECT cs."client_id" AS "client_id", MIN(cs."migrated_at") AS "m"
    FROM "${schema}"."client_services" AS cs
    WHERE cs."migrated_at" IS NOT NULL
    GROUP BY cs."client_id"
  ) AS sub
  WHERE c."id" = sub."client_id"
    AND c."migrated_at" IS NULL;

  -- v51: bloqueo de huérfanas hecho por el operador (no lo borran las limpiezas)
  ALTER TABLE "${schema}"."onu_denied"
    ADD COLUMN IF NOT EXISTS "manual" boolean NOT NULL DEFAULT true;

  -- v52: avistamientos de huérfanas (modelo ACS + fecha primera conexión)
  CREATE TABLE IF NOT EXISTS "${schema}"."onu_orphan_sightings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "sn" varchar(40) NOT NULL,
    "olt_id" uuid NULL,
    "olt_if" varchar(80) NULL,
    "olt_name" varchar(120) NULL,
    "board" varchar(20) NULL,
    "port" varchar(20) NULL,
    "pon_type" varchar(20) NULL,
    "model" varchar(80) NULL,
    "model_source" varchar(20) NULL,
    "driver_id" varchar(64) NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "uq_onu_orphan_sightings_sn" UNIQUE ("sn")
  );
  CREATE INDEX IF NOT EXISTS "idx_onu_orphan_sightings_first_seen"
    ON "${schema}"."onu_orphan_sightings" ("first_seen_at" DESC);

  -- v53: bindings eth OMCI → VLAN (IPTV) para listar ONUs por VLAN TV
  ALTER TABLE "${schema}"."onus"
    ADD COLUMN IF NOT EXISTS "eth_omci_vlans" jsonb NOT NULL DEFAULT '{}';

  -- v54: servidores TV (agente Go) ligados a activo topología tipo server
  CREATE TABLE IF NOT EXISTS "${schema}"."tv_servers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "device_id" uuid NOT NULL,
    "name" varchar(120) NOT NULL,
    "ssh_host" varchar(255) NOT NULL,
    "ssh_port" int NOT NULL DEFAULT 22,
    "ssh_username" varchar(120) NOT NULL,
    "ssh_password" text NULL,
    "api_base_url" varchar(512) NULL,
    "api_token" text NULL,
    "api_listen" varchar(64) NOT NULL DEFAULT ':8099',
    "agent_version" varchar(40) NULL,
    "status" varchar(20) NOT NULL DEFAULT 'pending',
    "last_error" text NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "uq_tv_servers_device_id"
    ON "${schema}"."tv_servers" ("device_id");
  CREATE INDEX IF NOT EXISTS "idx_tv_servers_status"
    ON "${schema}"."tv_servers" ("status");

  -- v55: segmento multicast para salidas de canales (IP incremental, mismo puerto)
  ALTER TABLE "${schema}"."tv_servers"
    ADD COLUMN IF NOT EXISTS "multicast_cidr" varchar(64) NULL;
  ALTER TABLE "${schema}"."tv_servers"
    ADD COLUMN IF NOT EXISTS "multicast_port" int NOT NULL DEFAULT 5000;

  -- v57: régimen de facturación de la empresa + día de instalación del cliente
  ALTER TABLE "${schema}"."billing_settings"
    ADD COLUMN IF NOT EXISTS "billing_regime" varchar(32) NOT NULL DEFAULT 'calendar_month';
  ALTER TABLE "${schema}"."clients"
    ADD COLUMN IF NOT EXISTS "install_day" smallint NULL;
`;

/** Bump when tenant DDL adds new tables/columns so existing processes re-apply. */
const TENANT_SCHEMA_VERSION = 57;

@Injectable()
export class TenantConnectionService implements OnModuleDestroy {
  private readonly cache = new Map<string, DataSource>();
  private readonly schemaReady = new Map<string, number>();

  constructor(private readonly config: ConfigService) {}

  async onModuleDestroy() {
    await Promise.all(
      [...this.cache.values()].map(async (ds) => {
        if (ds.isInitialized) {
          await ds.destroy();
        }
      }),
    );
    this.cache.clear();
  }

  async getDataSource(schemaName: string): Promise<DataSource> {
    const cached = this.cache.get(schemaName);
    if (cached?.isInitialized) {
      return cached;
    }

    const ds = new DataSource({
      type: 'postgres',
      host: this.config.get<string>('DATABASE_HOST', 'localhost'),
      port: Number(this.config.get<string>('DATABASE_PORT', '5432')),
      username: this.config.get<string>('DATABASE_USER', 'isp'),
      password: this.config.get<string>('DATABASE_PASSWORD', 'isp'),
      database: this.config.get<string>('DATABASE_NAME', 'isp_control'),
      schema: schemaName,
      entities: [
        TenantUser,
        Client,
        ServicePlan,
        SpeedProfile,
        ClientService,
        Zone,
        NetworkDevice,
        NetworkPort,
        NetworkLink,
        NetworkNode,
        NodeHeader,
        DeviceMetricSample,
        VpnTunnel,
        VpnTunnelClient,
        Tr069Profile,
        Tr069ProfileOlt,
        OnuProfile,
        OnuType,
        Onu,
        OnuMetricSample,
        OnuDenied,
        OnuAcsDriver,
        OnuFirmwareImage,
        OltConfigSnapshot,
        DeviceAuditEvent,
        NetworkAlarm,
        OnuOrphanSighting,
        IpPool,
        IpPoolAllocation,
        ServiceVlan,
        BillingSettings,
        InvoiceTemplate,
        Invoice,
        InvoiceItem,
        BillingProduct,
        ModuleConfig,
        CalendarEvent,
        InventoryItem,
        TvServer,
      ],
      synchronize: false,
    });

    await ds.initialize();
    this.cache.set(schemaName, ds);
    return ds;
  }

  async getUserRepository(schemaName: string): Promise<Repository<TenantUser>> {
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(TenantUser);
  }

  async getClientRepository(schemaName: string): Promise<Repository<Client>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(Client);
  }

  async getZoneRepository(schemaName: string): Promise<Repository<Zone>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(Zone);
  }

  async getServicePlanRepository(
    schemaName: string,
  ): Promise<Repository<ServicePlan>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(ServicePlan);
  }

  async getSpeedProfileRepository(
    schemaName: string,
  ): Promise<Repository<SpeedProfile>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(SpeedProfile);
  }

  async getClientServiceRepository(
    schemaName: string,
  ): Promise<Repository<ClientService>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(ClientService);
  }

  async getNetworkDeviceRepository(
    schemaName: string,
  ): Promise<Repository<NetworkDevice>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(NetworkDevice);
  }

  async getNetworkNodeRepository(
    schemaName: string,
  ): Promise<Repository<NetworkNode>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(NetworkNode);
  }

  async getNodeHeaderRepository(
    schemaName: string,
  ): Promise<Repository<NodeHeader>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(NodeHeader);
  }

  async getNetworkPortRepository(
    schemaName: string,
  ): Promise<Repository<NetworkPort>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(NetworkPort);
  }

  async getNetworkLinkRepository(
    schemaName: string,
  ): Promise<Repository<NetworkLink>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(NetworkLink);
  }

  async getDeviceMetricSampleRepository(
    schemaName: string,
  ): Promise<Repository<DeviceMetricSample>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(DeviceMetricSample);
  }

  async getVpnTunnelRepository(
    schemaName: string,
  ): Promise<Repository<VpnTunnel>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(VpnTunnel);
  }

  async getVpnTunnelClientRepository(
    schemaName: string,
  ): Promise<Repository<VpnTunnelClient>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(VpnTunnelClient);
  }

  async getTr069ProfileRepository(
    schemaName: string,
  ): Promise<Repository<Tr069Profile>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(Tr069Profile);
  }

  async getTr069ProfileOltRepository(
    schemaName: string,
  ): Promise<Repository<Tr069ProfileOlt>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(Tr069ProfileOlt);
  }

  async getOnuProfileRepository(
    schemaName: string,
  ): Promise<Repository<OnuProfile>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(OnuProfile);
  }

  async getOnuTypeRepository(schemaName: string): Promise<Repository<OnuType>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(OnuType);
  }

  async getOnuRepository(schemaName: string): Promise<Repository<Onu>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(Onu);
  }

  async getOnuMetricSampleRepository(
    schemaName: string,
  ): Promise<Repository<OnuMetricSample>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(OnuMetricSample);
  }




  async getNetworkAlarmRepository(
    schemaName: string,
  ): Promise<Repository<NetworkAlarm>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(NetworkAlarm);
  }

  async getDeviceAuditEventRepository(
    schemaName: string,
  ): Promise<Repository<DeviceAuditEvent>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(DeviceAuditEvent);
  }

  async getOnuAcsDriverRepository(
    schemaName: string,
  ): Promise<Repository<OnuAcsDriver>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(OnuAcsDriver);
  }

  async getOnuFirmwareImageRepository(
    schemaName: string,
  ): Promise<Repository<OnuFirmwareImage>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(OnuFirmwareImage);
  }

  async getOltConfigSnapshotRepository(
    schemaName: string,
  ): Promise<Repository<OltConfigSnapshot>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(OltConfigSnapshot);
  }

  async getOnuDeniedRepository(
    schemaName: string,
  ): Promise<Repository<OnuDenied>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(OnuDenied);
  }

  async getOnuOrphanSightingRepository(
    schemaName: string,
  ): Promise<Repository<OnuOrphanSighting>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(OnuOrphanSighting);
  }

  async getIpPoolRepository(schemaName: string): Promise<Repository<IpPool>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(IpPool);
  }

  async getIpPoolAllocationRepository(
    schemaName: string,
  ): Promise<Repository<IpPoolAllocation>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(IpPoolAllocation);
  }

  async getServiceVlanRepository(
    schemaName: string,
  ): Promise<Repository<ServiceVlan>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(ServiceVlan);
  }

  async getModuleConfigRepository(
    schemaName: string,
  ): Promise<Repository<ModuleConfig>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(ModuleConfig);
  }

  async getBillingSettingsRepository(
    schemaName: string,
  ): Promise<Repository<BillingSettings>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(BillingSettings);
  }

  async getInvoiceTemplateRepository(
    schemaName: string,
  ): Promise<Repository<InvoiceTemplate>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(InvoiceTemplate);
  }

  async getInvoiceRepository(schemaName: string): Promise<Repository<Invoice>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(Invoice);
  }

  async getInvoiceItemRepository(
    schemaName: string,
  ): Promise<Repository<InvoiceItem>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(InvoiceItem);
  }

  async getBillingProductRepository(
    schemaName: string,
  ): Promise<Repository<BillingProduct>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(BillingProduct);
  }

  async getInventoryItemRepository(
    schemaName: string,
  ): Promise<Repository<InventoryItem>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(InventoryItem);
  }

  async getTvServerRepository(
    schemaName: string,
  ): Promise<Repository<TvServer>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(TvServer);
  }

  async getCalendarEventRepository(
    schemaName: string,
  ): Promise<Repository<CalendarEvent>> {
    await this.ensureTenantSchema(schemaName);
    const ds = await this.getDataSource(schemaName);
    return ds.getRepository(CalendarEvent);
  }

  async ensureTenantSchema(schemaName: string): Promise<void> {
    if (this.schemaReady.get(schemaName) === TENANT_SCHEMA_VERSION) {
      return;
    }

    const ds = await this.getPublicAdminDataSource();
    await ds.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await ds.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL UNIQUE,
        "password_hash" varchar(255) NOT NULL,
        "name" varchar(120) NOT NULL,
        "role" varchar(20) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await ds.query(CRM_DDL(schemaName));
    await ds.query(TOPOLOGY_DDL(schemaName));
    await ds.query(TOPOLOGY_ALTER(schemaName));
    await ds.destroy();

    await this.evictSchema(schemaName);
    this.schemaReady.set(schemaName, TENANT_SCHEMA_VERSION);
  }

  async dropTenantSchema(schemaName: string): Promise<void> {
    this.schemaReady.delete(schemaName);
    await this.evictSchema(schemaName);
    const ds = await this.getPublicAdminDataSource();
    await ds.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await ds.destroy();
  }

  private async evictSchema(schemaName: string) {
    const cached = this.cache.get(schemaName);
    if (cached) {
      if (cached.isInitialized) {
        await cached.destroy();
      }
      this.cache.delete(schemaName);
    }
  }

  /** Admin DataSource (no tenant schema) for DDL / cross-schema lookup. */
  async getPublicAdminDataSource(): Promise<DataSource> {
    const ds = new DataSource({
      type: 'postgres',
      host: this.config.get<string>('DATABASE_HOST', 'localhost'),
      port: Number(this.config.get<string>('DATABASE_PORT', '5432')),
      username: this.config.get<string>('DATABASE_USER', 'isp'),
      password: this.config.get<string>('DATABASE_PASSWORD', 'isp'),
      database: this.config.get<string>('DATABASE_NAME', 'isp_control'),
      synchronize: false,
    });
    await ds.initialize();
    return ds;
  }
}
