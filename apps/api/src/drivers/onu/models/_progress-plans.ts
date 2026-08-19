/**
 * Planes de progreso ACS gruesos (modelos sin pasos atómicos aún).
 */
import type { OnuProgressStepDef } from '../types';
import {
  netStepsFromVerifyChecks,
  DEFAULT_VERIFY_CHECKS,
  TR098_VERIFY_CHECKS,
} from '../types';

export const ACS_ENSURE_SERVICE_STEP: OnuProgressStepDef = {
  id: 'ensure_service_wan',
  label: 'Aprovisionar / curar WAN de servicio (ACS)',
  phase: 'acs',
};

export const ACS_SPV_STEP: OnuProgressStepDef = {
  id: 'apply_service_spv',
  label: 'Empujar hojas WAN (SPV)',
  phase: 'acs',
};

export const HGU_VEIP_PROGRESS_PLAN: OnuProgressStepDef[] = [
  ACS_ENSURE_SERVICE_STEP,
  ...netStepsFromVerifyChecks(TR098_VERIFY_CHECKS),
];

export const FIBERHOME_HG6143D_PROGRESS_PLAN: OnuProgressStepDef[] = [
  ACS_ENSURE_SERVICE_STEP,
  ...netStepsFromVerifyChecks(TR098_VERIFY_CHECKS),
];

export const GENERIC_HUAWEI_PROGRESS_PLAN: OnuProgressStepDef[] = [
  ACS_SPV_STEP,
  ...netStepsFromVerifyChecks(TR098_VERIFY_CHECKS),
];

export const GENERIC_FIBERHOME_PROGRESS_PLAN: OnuProgressStepDef[] = [
  ACS_SPV_STEP,
  ...netStepsFromVerifyChecks(TR098_VERIFY_CHECKS),
];

export const GENERIC_ZTE_PROGRESS_PLAN: OnuProgressStepDef[] = [
  ACS_SPV_STEP,
  ...netStepsFromVerifyChecks(DEFAULT_VERIFY_CHECKS),
];

export const GENERIC_UNKNOWN_PROGRESS_PLAN: OnuProgressStepDef[] = [
  ACS_SPV_STEP,
  ...netStepsFromVerifyChecks(DEFAULT_VERIFY_CHECKS),
];
