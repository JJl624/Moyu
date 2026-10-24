const {test}=require('node:test');
const assert=require('node:assert/strict');
const {outputLines,emulatorSerials,accelerationStatus,accelerationMode,emulatorExitDetail}=require('../scripts/start-android.mjs');
test('Android console output identifies the same AVD with Windows double-CR and Unix line endings',()=>{
  assert.equal(outputLines('MoyuPhone\r\r\nOK\r\r\n')[0],'MoyuPhone');
  assert.equal(outputLines('MoyuPhone\nOK\n')[0],'MoyuPhone');
  assert.deepEqual(outputLines('PhoneA\r\r\nPhoneB\r\r\n'),['PhoneA','PhoneB']);
  assert.deepEqual(emulatorSerials('List of devices attached\r\nemulator-5580\tdevice\r\nemulator-5582\toffline\r\nphysical-phone\tdevice\r\n'),['emulator-5580']);
  assert.deepEqual(emulatorSerials('List of devices attached\nemulator-5580 device\n'),['emulator-5580']);
});
test('Unavailable acceleration stops before launch with a system-specific repair instruction; software requires an explicit choice',()=>{
 const missing=accelerationStatus('accel:\r\r\n6\r\r\nAndroid Emulator hypervisor driver is not installed on this machine\r\r\naccel\r\r\n');
 assert.equal(missing.available,false);assert.throws(()=>accelerationMode('auto',missing,'win32'),/Windows 虚拟机监控程序平台/);assert.throws(()=>accelerationMode('auto',missing,'linux'),/配置系统虚拟化加速/);
 for(const detail of ['WHPX(10.0.19044) is installed and usable.','KVM is installed and usable.','Hypervisor.Framework OS X Version 13.2']){
  const status=accelerationStatus('accel:\n0\n'+detail+'\naccel\n');assert.equal(status.available,true);assert.equal(accelerationMode('auto',status),'auto');assert.equal(accelerationMode('on',status),'on');
 }
 assert.equal(accelerationMode('off',missing),'off');assert.throws(()=>accelerationMode('on',missing),/hypervisor driver/);assert.throws(()=>accelerationMode('invalid',missing),/auto、on 或 off/);
 assert.equal(accelerationMode('auto',accelerationStatus('unknown output')),'auto');
});
test('Startup diagnostics include the current fatal reason and acceleration status',()=>{
 assert.equal(emulatorExitDetail('INFO | old progress\r\nERROR | x86_64 emulation currently requires hardware acceleration!\r\nCPU acceleration status: driver missing\r\n'),'ERROR | x86_64 emulation currently requires hardware acceleration!\nCPU acceleration status: driver missing');
 assert.equal(emulatorExitDetail('INFO | ready\n'),'');
});
