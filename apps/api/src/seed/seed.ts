import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../app.module';
import { PlatformAdmin } from '../auth/entities/platform-admin.entity';
import { TenantProvisioningService } from '../tenants/tenant-provisioning.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantConnectionService } from '../database/tenant-connection.service';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const adminRepo = app.get<Repository<PlatformAdmin>>(
    getRepositoryToken(PlatformAdmin),
  );
  const provisioning = app.get(TenantProvisioningService);
  const tenants = app.get(TenantsService);
  const tenantConnections = app.get(TenantConnectionService);

  const adminEmail = 'admin@isp.local';
  const adminPassword = 'Admin123!';
  let admin = await adminRepo.findOne({ where: { email: adminEmail } });
  if (!admin) {
    admin = adminRepo.create({
      email: adminEmail,
      name: 'Super Admin',
      role: 'superadmin',
      passwordHash: await bcrypt.hash(adminPassword, 10),
    });
    await adminRepo.save(admin);
    console.log(
      `Created platform superadmin: ${adminEmail} / ${adminPassword}`,
    );
  } else {
    if (admin.role !== 'superadmin') {
      admin.role = 'superadmin';
      admin.name = admin.name || 'Super Admin';
      await adminRepo.save(admin);
      console.log(`Updated ${adminEmail} → role superadmin`);
    } else {
      console.log(`Platform superadmin already exists: ${adminEmail}`);
    }
  }

  const existing = (await tenants.list()).find((t) => t.slug === 'demo');
  if (!existing) {
    const result = await provisioning.provision({
      name: 'Demo ISP',
      legalName: 'Demo ISP S.A.',
      phone: '+58 212 0000000',
      address: 'Av. Principal, Caracas',
      slug: 'demo',
      ownerName: 'Demo User',
      ownerEmail: 'user@demo.local',
      ownerPassword: 'User123!',
    });
    console.log(
      `Created tenant: ${result.tenant.slug} / owner ${result.owner.email}`,
    );
  } else {
    console.log('Tenant already exists: demo');
  }

  const demo = (await tenants.list()).find((t) => t.slug === 'demo');
  if (demo) {
    await seedCrmDemo(tenantConnections, demo.schemaName);
    await seedTopologyDemo(tenantConnections, demo.schemaName);
  }

  await app.close();
  console.log('Seed completed.');
}

async function seedCrmDemo(
  tenantConnections: TenantConnectionService,
  schemaName: string,
) {
  await tenantConnections.ensureTenantSchema(schemaName);

  const plans =
    await tenantConnections.getServicePlanRepository(schemaName);
  const profiles =
    await tenantConnections.getSpeedProfileRepository(schemaName);
  const clients = await tenantConnections.getClientRepository(schemaName);
  const services =
    await tenantConnections.getClientServiceRepository(schemaName);

  let profile = await profiles.findOne({ where: { name: '100M' } });
  if (!profile) {
    profile = await profiles.save(
      profiles.create({
        name: '100M',
        downloadMbps: 100,
        uploadMbps: 50,
        description: 'Perfil demo 100/50',
        isActive: true,
        oltIds: [],
      }),
    );
    console.log(`Created demo speed profile: ${profile.name}`);
  }

  let plan = await plans.findOne({ where: { name: 'Internet 100 Mbps' } });
  if (!plan) {
    plan = await plans.save(
      plans.create({
        name: 'Internet 100 Mbps',
        price: '29.99',
        installationFee: '0.00',
        installationFeeOnFirstInvoice: true,
        invoiceLabel: 'Internet residencial 100/50',
        speedProfileId: profile.id,
        downloadSpeed: profile.downloadMbps,
        uploadSpeed: profile.uploadMbps,
        invoicingPeriod: 1,
        invoicingPeriodType: 'month',
        billingAnchor: 'installation',
        billingCycleDay: 'first',
        serviceTypes: ['internet'],
        type: 'Internet',
        isActive: true,
      }),
    );
    console.log(`Created demo plan: ${plan.name}`);
  } else {
    if (!plan.speedProfileId) {
      plan.speedProfileId = profile.id;
      plan.downloadSpeed = profile.downloadMbps;
      plan.uploadSpeed = profile.uploadMbps;
      await plans.save(plan);
      console.log(`Linked demo plan to speed profile: ${profile.name}`);
    } else {
      console.log(`Demo plan already exists: ${plan.name}`);
    }
  }

  let client = await clients.findOne({
    where: { email: 'cliente@demo.local' },
  });
  if (!client) {
    client = await clients.save(
      clients.create({
        firstName: 'Ana',
        lastName: 'Pérez',
        companyName: '',
        isLead: false,
        email: 'cliente@demo.local',
        phone: '+58 412 5550101',
        street: 'Calle 12 #45',
        city: 'Caracas',
        zipCode: '1010',
        note: 'Cliente demo CRM Fase 1',
        isActive: true,
      }),
    );
    console.log(`Created demo client: ${client.email}`);
  } else {
    console.log(`Demo client already exists: ${client.email}`);
  }

  const existingService = await services.findOne({
    where: { clientId: client.id, servicePlanId: plan.id },
  });
  if (!existingService) {
    await services.save(
      services.create({
        clientId: client.id,
        servicePlanId: plan.id,
        name: plan.name,
        price: plan.price,
        activeFrom: new Date().toISOString().slice(0, 10),
        activeTo: null,
        status: 'active',
        street: client.street,
        city: client.city,
        zipCode: client.zipCode,
        note: '',
      }),
    );
    console.log('Created demo client service (active contract)');
  } else {
    console.log('Demo client service already exists');
  }
}

async function seedTopologyDemo(
  tenantConnections: TenantConnectionService,
  schemaName: string,
) {
  await tenantConnections.ensureTenantSchema(schemaName);

  const devices =
    await tenantConnections.getNetworkDeviceRepository(schemaName);
  const ports = await tenantConnections.getNetworkPortRepository(schemaName);
  const links = await tenantConnections.getNetworkLinkRepository(schemaName);

  let internet = await devices.findOne({ where: { type: 'internet' } });
  if (!internet) {
    internet = await devices.save(
      devices.create({
        name: 'Internet',
        type: 'internet',
        note: 'Nube WAN fija — conecta routers y switches',
        isActive: true,
      }),
    );
    const wanPorts = [];
    for (let i = 1; i <= 8; i++) {
      wanPorts.push(
        ports.create({
          deviceId: internet.id,
          name: `WAN ${i}`,
          ipAddress: null,
          sortOrder: i,
        }),
      );
    }
    await ports.save(wanPorts);
    console.log('Created demo device: Internet (cloud)');
  } else {
    console.log('Demo device already exists: Internet');
  }

  let router = await devices.findOne({ where: { name: 'Core Router' } });
  if (!router) {
    router = await devices.save(
      devices.create({
        name: 'Core Router',
        type: 'router',
        note: 'Gateway demo',
        isActive: true,
      }),
    );
    await ports.save([
      ports.create({
        deviceId: router.id,
        name: 'eth0',
        ipAddress: '10.0.0.1',
        sortOrder: 1,
      }),
      ports.create({
        deviceId: router.id,
        name: 'eth1',
        ipAddress: '10.0.1.1',
        sortOrder: 2,
      }),
    ]);
    console.log('Created demo device: Core Router');
  } else {
    console.log('Demo device already exists: Core Router');
  }

  let sw = await devices.findOne({ where: { name: 'Agg Switch' } });
  if (!sw) {
    sw = await devices.save(
      devices.create({
        name: 'Agg Switch',
        type: 'switch',
        note: 'Agregación',
        isActive: true,
      }),
    );
    await ports.save([
      ports.create({
        deviceId: sw.id,
        name: 'Port 1',
        ipAddress: null,
        sortOrder: 1,
      }),
      ports.create({
        deviceId: sw.id,
        name: 'Port 2',
        ipAddress: null,
        sortOrder: 2,
      }),
      ports.create({
        deviceId: sw.id,
        name: 'Port 3',
        ipAddress: null,
        sortOrder: 3,
      }),
    ]);
    console.log('Created demo device: Agg Switch');
  } else {
    console.log('Demo device already exists: Agg Switch');
  }

  let olt = await devices.findOne({ where: { name: 'OLT Central' } });
  if (!olt) {
    olt = await devices.save(
      devices.create({
        name: 'OLT Central',
        type: 'olt',
        note: 'Huawei demo',
        isActive: true,
      }),
    );
    await ports.save([
      ports.create({
        deviceId: olt.id,
        name: 'Uplink',
        ipAddress: '10.0.1.10',
        sortOrder: 1,
      }),
      ports.create({
        deviceId: olt.id,
        name: 'PON1',
        ipAddress: null,
        sortOrder: 2,
      }),
    ]);
    console.log('Created demo device: OLT Central');
  } else {
    console.log('Demo device already exists: OLT Central');
  }

  const routerEth0 = await ports.findOne({
    where: { deviceId: router.id, name: 'eth0' },
  });
  const routerEth1 = await ports.findOne({
    where: { deviceId: router.id, name: 'eth1' },
  });
  const internetWan1 = await ports.findOne({
    where: { deviceId: internet.id, name: 'WAN 1' },
  });
  const swPort1 = await ports.findOne({
    where: { deviceId: sw.id, name: 'Port 1' },
  });
  const swPort2 = await ports.findOne({
    where: { deviceId: sw.id, name: 'Port 2' },
  });
  const oltUplink = await ports.findOne({
    where: { deviceId: olt.id, name: 'Uplink' },
  });

  async function ensureLink(aId: string, bId: string, label: string) {
    const [pa, pb] = aId < bId ? [aId, bId] : [bId, aId];
    const existing = await links.findOne({
      where: [
        { portAId: pa, portBId: pb },
        { portAId: aId },
        { portBId: aId },
        { portAId: bId },
        { portBId: bId },
      ],
    });
    if (existing) {
      console.log(`Demo link already exists: ${label}`);
      return;
    }
    await links.save(links.create({ portAId: pa, portBId: pb }));
    console.log(`Created demo link: ${label}`);
  }

  if (routerEth0 && internetWan1) {
    await ensureLink(
      routerEth0.id,
      internetWan1.id,
      'Router eth0 ↔ Internet WAN 1',
    );
  }
  if (routerEth1 && swPort1) {
    await ensureLink(routerEth1.id, swPort1.id, 'Router eth1 ↔ Switch Port 1');
  }
  if (swPort2 && oltUplink) {
    await ensureLink(swPort2.id, oltUplink.id, 'Switch Port 2 ↔ OLT Uplink');
  }
}

seed().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
