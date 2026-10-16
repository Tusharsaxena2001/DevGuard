/** What this machine calls itself, sent once at enrollment so admins can recognise the device. */
export interface DeviceInfo {
  readonly name: string;
  readonly os: string;
}
