// Type declarations for the W3C Contact Picker API
// Supported in Safari iOS 14+ and Chrome Android

interface ContactInfo {
  name?: string[];
  tel?: string[];
}

interface ContactsManager {
  select(
    properties: ('name' | 'tel' | 'email')[],
    options?: { multiple?: boolean },
  ): Promise<ContactInfo[]>;
}

interface Navigator {
  contacts?: ContactsManager;
}
