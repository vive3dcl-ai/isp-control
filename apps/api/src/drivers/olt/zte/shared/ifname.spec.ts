import {
  detectZteFwFamily,
  toZteCanonicalOltIf,
  toZteCanonicalOnuIf,
  toZteCliOltIf,
  toZteCliOnuIf,
  buildZteC6xxVportIf,
  parseZteOltIfParts,
  parseZteOnuIfParts,
  zteIptvServicePortStrategy,
} from './ifname';
import { detectOltSubtypeFromProduct } from '../../../../topology/olts/olt.constants';
import {
  normalizePonOltIfName,
  parsePonOltIfName,
} from './zte-olt-pon.util';

describe('zte-olt-firmware.util / C6xx dialect', () => {
  describe('detectZteFwFamily', () => {
    it('uses subtype', () => {
      expect(detectZteFwFamily({ subtype: 'zte_c650' })).toBe('c6xx');
      expect(detectZteFwFamily({ subtype: 'zte_c320' })).toBe('c3xx');
    });

    it('uses product banner', () => {
      expect(detectZteFwFamily({ product: 'C600' })).toBe('c6xx');
      expect(detectZteFwFamily({ product: 'C300' })).toBe('c3xx');
    });

    it('uses Titan card types', () => {
      expect(detectZteFwFamily({ cardTypes: ['GFGH', 'SFUC'] })).toBe('c6xx');
      expect(detectZteFwFamily({ cardTypes: ['GTGH', 'SMXA'] })).toBe('c3xx');
    });
  });

  describe('ifName dual forms', () => {
    it('parses C3xx and C6xx OLT ifNames', () => {
      expect(parseZteOltIfParts('gpon-olt_1/2/3')).toEqual({
        family: 'gpon',
        shelf: '1',
        slot: '2',
        port: '3',
      });
      expect(parseZteOltIfParts('gpon_olt-1/2/3')).toEqual({
        family: 'gpon',
        shelf: '1',
        slot: '2',
        port: '3',
      });
    });

    it('canonicalizes and emits CLI forms', () => {
      expect(toZteCanonicalOltIf('gpon_olt-1/5/2')).toBe('gpon-olt_1/5/2');
      expect(toZteCliOltIf('gpon-olt_1/5/2', 'c6xx')).toBe('gpon_olt-1/5/2');
      expect(toZteCliOltIf('gpon-olt_1/5/2', 'c3xx')).toBe('gpon-olt_1/5/2');
      expect(toZteCliOnuIf('gpon-onu_1/5/2:7', 'c6xx')).toBe(
        'gpon_onu-1/5/2:7',
      );
      expect(toZteCanonicalOnuIf('gpon_onu-1/5/2:7')).toBe('gpon-onu_1/5/2:7');
    });

    it('builds Titan vport ifName', () => {
      expect(buildZteC6xxVportIf('gpon-onu_1/2/3:4', 1)).toBe(
        'vport-1/2/3.1:4',
      );
      // IPTV = vport 3 (WAN=1, mgmt=2)
      expect(buildZteC6xxVportIf('gpon-onu_1/2/4:12', 3)).toBe(
        'vport-1/2/4.3:12',
      );
    });

    it('IPTV service-port strategy: Titan vport, C3xx classic', () => {
      expect(zteIptvServicePortStrategy('c6xx')).toBe('c6xx-vport');
      expect(zteIptvServicePortStrategy('c3xx')).toBe('c3xx-classic');
      expect(zteIptvServicePortStrategy('unknown')).toBe('c3xx-classic');
    });

    it('normalizePonOltIfName accepts both', () => {
      expect(normalizePonOltIfName('gpon_olt-1/10/1')).toBe('gpon-olt_1/10/1');
      expect(parsePonOltIfName('gpon_olt-1/10/1')?.slot).toBe('10');
    });
  });

  describe('detectOltSubtypeFromProduct', () => {
    it('matches C6xx before C300', () => {
      expect(detectOltSubtypeFromProduct('C600')).toBe('zte_c600');
      expect(detectOltSubtypeFromProduct('C680')).toBe('zte_c680');
      expect(detectOltSubtypeFromProduct('C650')).toBe('zte_c650');
      expect(detectOltSubtypeFromProduct('C620')).toBe('zte_c620');
      expect(detectOltSubtypeFromProduct('C610')).toBe('zte_c610');
      expect(detectOltSubtypeFromProduct('C300')).toBe('zte_c300');
    });
  });

  describe('parseZteOnuIfParts', () => {
    it('parses both ONU forms', () => {
      expect(parseZteOnuIfParts('gpon-onu_1/2/3:9')?.onuId).toBe('9');
      expect(parseZteOnuIfParts('gpon_onu-1/2/3:9')?.onuId).toBe('9');
    });
  });
});
