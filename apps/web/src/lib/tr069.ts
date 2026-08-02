export type CwmpStatus = "offline" | "online" | "unknown";

export type Tr069ProfileOltRef = {
  id: string;
  name: string;
};

export type Tr069Profile = {
  id: string;
  name: string;
  acsUrl: string;
  acsPort: number;
  acsUsername: string;
  acsPassword: string;
  connectionRequestUsername: string;
  connectionRequestPassword: string;
  periodicInformEnable: boolean;
  periodicInformInterval: number;
  cwmpStatus: CwmpStatus;
  oltIds: string[];
  olts: Tr069ProfileOltRef[];
  createdAt: string;
  updatedAt: string;
};

export type Tr069ProfilesResponse = {
  profiles: Tr069Profile[];
  cwmpStatus: CwmpStatus;
};

export type AcsServiceStatus = "online" | "offline" | "unknown";

export type Tr069AcsHealthRow = {
  profileId: string;
  profileName: string;
  type: "integrated";
  nbiEndpoint: string | null;
  acsUrl: string;
  services: {
    cwmp: AcsServiceStatus;
    nbi: AcsServiceStatus;
    fs: AcsServiceStatus;
  };
  devicesInAcs: number | null;
  faults: number;
};

export type Tr069FaultRow = {
  when: string;
  profileId: string;
  profileName: string;
  deviceId: string | null;
  channel: string;
  code: string;
  message: string;
  retries: number;
};

export type Tr069OnuRow = {
  onuId: string;
  deviceId: string;
  serial: string;
  oltName: string | null;
  model: string | null;
  description: string | null;
  ip: string | null;
  lastInform: string | null;
  state: string;
  profileId: string;
  profileName: string;
};

export type Tr069StatusResponse = {
  summary: {
    managedOnus: number;
    onlineInformed: number;
    notInformedRecently: number;
    activeFaults: number;
  };
  acsHealth: Tr069AcsHealthRow[];
  faults: Tr069FaultRow[];
  onus: Tr069OnuRow[];
  refreshedAt: string;
};
