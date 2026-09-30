export const SHIJI_LICENSE_PRODUCT = 'shiji-workbench-full'
export const SHIJI_LICENSE_VERSION = 1

export interface OfflineLicenseStatus {
  activated: boolean
  deviceCode: string
  licenseId?: string
  message?: string
}
