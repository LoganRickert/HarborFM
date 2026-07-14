export type ValueRecipientForm = {
  type: string;
  address: string;
  split: string;
  name: string;
  customKey: string;
  customValue: string;
  fee: boolean;
};

export type ValueBlockForm = {
  type: string;
  method: string;
  suggested: string;
  recipients: ValueRecipientForm[];
};

export function emptyValueRecipient(): ValueRecipientForm {
  return {
    type: 'node',
    address: '',
    split: '100',
    name: '',
    customKey: '',
    customValue: '',
    fee: false,
  };
}

export function emptyValueBlock(): ValueBlockForm {
  return {
    type: 'lightning',
    method: 'keysend',
    suggested: '',
    recipients: [emptyValueRecipient()],
  };
}
