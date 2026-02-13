import { useState, useEffect } from 'react';
import type { Export, ExportCreate, ExportMode, ExportUpdate } from '../../api/exports';
import { EXPORT_MODE_LABELS } from '../../api/exports';
import localStyles from './Exports.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface ExportFormProps {
  open: boolean;
  formMode: 'create' | 'edit';
  initial?: Export;
  onSubmitCreate: (body: ExportCreate) => void;
  onSubmitUpdate: (exportId: string, body: ExportUpdate) => void;
  error?: string;
}

export function ExportForm({
  open,
  formMode,
  initial,
  onSubmitCreate,
  onSubmitUpdate,
  error,
}: ExportFormProps) {
  const currentMode = (initial?.mode as ExportMode) ?? 'S3';
  const [exportMode, setExportMode] = useState<ExportMode>(currentMode);
  const [name, setName] = useState(initial?.name ?? '');
  const [publicBaseUrl, setPublicBaseUrl] = useState(initial?.public_base_url ?? '');
  const [fields, setFields] = useState<Record<string, string | number | boolean>>(() => ({
    bucket: '', prefix: '', region: 'auto', endpoint_url: '',
    access_key_id: '', secret_access_key: '',
    host: '', port: 21, username: '', password: '', path: '', secure: false,
    private_key: '', url: '', api_url: '', api_key: '', gateway_url: '',
    share: '', domain: '',
  }));
  const isEdit = formMode === 'edit';

  useEffect(() => {
    if (!open) return;
    const mode = (initial?.mode as ExportMode) ?? 'S3';
    setExportMode(mode);
    setName(initial?.name ?? '');
    setPublicBaseUrl(initial?.public_base_url ?? '');
    const isEditMode = formMode === 'edit';
    const defaultPort = mode === 'SFTP' ? 22 : 21;
    setFields({
      bucket: initial?.bucket ?? '', prefix: initial?.prefix ?? '', region: initial?.region ?? 'auto', endpoint_url: initial?.endpoint_url ?? '',
      access_key_id: '', secret_access_key: '',
      host: '', port: isEditMode ? '' : defaultPort, username: '', password: '', path: '', secure: false,
      private_key: '', url: '', api_url: '', api_key: '', gateway_url: '',
      share: '', domain: '',
    });
  }, [open, initial, formMode]);

  const set = (key: string, value: string | number | boolean) => setFields((p) => ({ ...p, [key]: value }));
  const v = (key: string) => fields[key] ?? '';

  const buildCreateBody = (): ExportCreate => {
    const nameTrim = name.trim();
    const pub = publicBaseUrl.trim() || undefined;
    switch (exportMode) {
      case 'S3':
        return {
          mode: 'S3',
          name: nameTrim,
          bucket: String(v('bucket')).trim(),
          prefix: String(v('prefix')).trim(),
          region: String(v('region')).trim(),
          endpoint_url: String(v('endpoint_url')).trim() || null,
          access_key_id: String(v('access_key_id')).trim(),
          secret_access_key: String(v('secret_access_key')).trim(),
          public_base_url: pub ?? null,
        };
      case 'FTP':
        return {
          mode: 'FTP',
          name: nameTrim,
          host: String(v('host')).trim(),
          port: Number(v('port')) || 21,
          username: String(v('username')).trim(),
          password: String(v('password')).trim(),
          path: String(v('path')).trim(),
          secure: Boolean(v('secure')),
          public_base_url: pub ?? null,
        };
      case 'SFTP':
        return {
          mode: 'SFTP',
          name: nameTrim,
          host: String(v('host')).trim(),
          port: Number(v('port')) || 22,
          username: String(v('username')).trim(),
          password: String(v('password')).trim() || undefined,
          private_key: String(v('private_key')).trim() || undefined,
          path: String(v('path')).trim(),
          public_base_url: pub ?? null,
        };
      case 'WebDAV':
        return {
          mode: 'WebDAV',
          name: nameTrim,
          url: String(v('url')).trim(),
          username: String(v('username')).trim(),
          password: String(v('password')).trim(),
          path: String(v('path')).trim(),
          public_base_url: pub ?? null,
        };
      case 'IPFS':
        return {
          mode: 'IPFS',
          name: nameTrim,
          api_url: String(v('api_url')).trim(),
          api_key: String(v('api_key')).trim() || undefined,
          username: String(v('username')).trim() || undefined,
          password: String(v('password')).trim() || undefined,
          path: String(v('path')).trim(),
          gateway_url: String(v('gateway_url')).trim() || null,
          public_base_url: pub ?? null,
        };
      case 'SMB': {
        const smbPort = v('port');
        return {
          mode: 'SMB',
          name: nameTrim,
          host: String(v('host')).trim(),
          port: smbPort !== '' && smbPort !== undefined && Number(smbPort) > 0 ? Number(smbPort) : undefined,
          share: String(v('share')).trim(),
          username: String(v('username')).trim(),
          password: String(v('password')).trim(),
          domain: String(v('domain')).trim(),
          path: String(v('path')).trim(),
          public_base_url: pub ?? null,
        };
      }
      default:
        return {
          mode: 'S3',
          name: nameTrim,
          bucket: '',
          prefix: '',
          region: '',
          endpoint_url: null,
          access_key_id: '',
          secret_access_key: '',
        };
    }
  };

  const buildUpdateBody = (): ExportUpdate => {
    const body: ExportUpdate = {
      mode: exportMode,
      name: name.trim(),
      public_base_url: publicBaseUrl.trim() || null,
      endpoint_url: null,
    };
    if (exportMode === 'S3') {
      if (String(v('bucket')).trim()) body.bucket = String(v('bucket')).trim();
      if (String(v('region')).trim()) body.region = String(v('region')).trim();
      const ep = String(v('endpoint_url')).trim();
      body.endpoint_url = ep || null;
      if (String(v('access_key_id')).trim() || String(v('secret_access_key')).trim()) {
        body.access_key_id = String(v('access_key_id')).trim();
        body.secret_access_key = String(v('secret_access_key')).trim();
      }
      if (String(v('prefix')).trim() !== undefined) body.prefix = String(v('prefix')).trim();
    } else {
      if (String(v('host')).trim()) body.host = String(v('host')).trim();
      const portVal = v('port');
      if (portVal !== '' && portVal !== undefined && Number(portVal) > 0) body.port = Number(portVal);
      if (String(v('username')).trim()) body.username = String(v('username')).trim();
      if (String(v('password')).trim()) body.password = String(v('password')).trim();
      if (String(v('path')).trim() !== undefined) body.path = String(v('path')).trim();
      if (exportMode === 'FTP') body.secure = Boolean(v('secure'));
      if (exportMode === 'SFTP' && String(v('private_key')).trim()) body.private_key = String(v('private_key')).trim();
      if (exportMode === 'WebDAV' && String(v('url')).trim()) body.url = String(v('url')).trim();
      if (exportMode === 'IPFS') {
        if (String(v('api_url')).trim()) body.api_url = String(v('api_url')).trim();
        if (String(v('api_key')).trim()) body.api_key = String(v('api_key')).trim();
        if (String(v('username')).trim()) body.username = String(v('username')).trim();
        if (String(v('password')).trim()) body.password = String(v('password')).trim();
        const gw = String(v('gateway_url')).trim();
        body.gateway_url = gw || null;
      }
      if (exportMode === 'SMB') {
        const smbPortVal = v('port');
        if (smbPortVal !== '' && smbPortVal !== undefined && Number(smbPortVal) > 0) body.port = Number(smbPortVal);
        if (String(v('share')).trim()) body.share = String(v('share')).trim();
        if (String(v('domain')).trim()) body.domain = String(v('domain')).trim();
      }
    }
    return body;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formMode === 'create') {
      onSubmitCreate(buildCreateBody());
    } else if (initial?.id) {
      onSubmitUpdate(initial.id, buildUpdateBody());
    }
  };

  const placeholderKeep = isEdit ? '(Leave blank to keep existing)' : '';

  return (
    <div>
      <form id="add-delivery-form" className={styles.addExportForm} onSubmit={handleSubmit}>
        <label className={styles.label}>
          Name
          <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" required />
        </label>

        <label className={styles.label}>
          Public base URL (optional)
          <input className={styles.input} type="url" value={publicBaseUrl} onChange={(e) => setPublicBaseUrl(e.target.value)} placeholder="https://cdn.example.com" />
        </label>

        <div className={styles.label}>
          Destination type
          <div className={`${styles.statusToggle} ${styles.exportModeToggle}`} role="group" aria-label="Export destination type">
            {(Object.entries(EXPORT_MODE_LABELS) as [ExportMode, string][]).map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={exportMode === m ? styles.statusToggleActive : styles.statusToggleBtn}
                onClick={() => {
                  if (m === exportMode) return;
                  setExportMode(m);
                  setFields({
                    bucket: '', prefix: '', region: 'auto', endpoint_url: '',
                    access_key_id: '', secret_access_key: '',
                    host: '', port: m === 'SMB' ? '' : (m === 'SFTP' ? 22 : 21), username: '', password: '', path: '', secure: false,
                    private_key: '', url: '', api_url: '', api_key: '', gateway_url: '',
                    share: '', domain: '',
                  });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {exportMode === 'S3' && (
          <>
            <label className={styles.label}>Bucket
              <input className={styles.input} value={String(v('bucket'))} onChange={(e) => set('bucket', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            <label className={styles.label}>Prefix (e.g. podcasts/my-show/)
              <input className={styles.input} value={String(v('prefix'))} onChange={(e) => set('prefix', e.target.value)} placeholder={isEdit ? placeholderKeep : undefined} />
            </label>
            <label className={styles.label}>Region
              <input className={styles.input} value={String(v('region'))} onChange={(e) => set('region', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            <label className={styles.label}>Endpoint URL (optional, for R2 or other S3-compatible)
              <input className={styles.input} type="url" value={String(v('endpoint_url'))} onChange={(e) => set('endpoint_url', e.target.value)} placeholder={isEdit ? placeholderKeep : 'https://...'} />
            </label>
            <label className={styles.label}>Access Key ID
              <input className={styles.input} type="text" value={String(v('access_key_id'))} onChange={(e) => set('access_key_id', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            <label className={styles.label}>Secret Access Key
              <input className={styles.input} type="password" value={String(v('secret_access_key'))} onChange={(e) => set('secret_access_key', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
          </>
        )}

        {(exportMode === 'FTP' || exportMode === 'SFTP') && (
          <>
            <label className={styles.label}>Host
              <input className={styles.input} value={String(v('host'))} onChange={(e) => set('host', e.target.value)} placeholder={isEdit ? placeholderKeep : 'ftp.example.com'} required={!isEdit} />
            </label>
            <label className={styles.label}>Port
              <input className={styles.input} type="number" value={v('port') === '' || v('port') === undefined ? '' : String(v('port'))} onChange={(e) => set('port', e.target.value === '' ? '' : (parseInt(e.target.value, 10) || 0))} placeholder={isEdit ? placeholderKeep : undefined} min={1} max={65535} />
            </label>
            <label className={styles.label}>Username
              <input className={styles.input} value={String(v('username'))} onChange={(e) => set('username', e.target.value)} placeholder={isEdit ? placeholderKeep : undefined} required={!isEdit} />
            </label>
            <label className={styles.label}>Password
              <input className={styles.input} type="password" value={String(v('password'))} onChange={(e) => set('password', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            {exportMode === 'SFTP' && (
              <label className={styles.label}>Private key (optional, alternative to password)
                <textarea className={styles.input} rows={3} value={String(v('private_key'))} onChange={(e) => set('private_key', e.target.value)} placeholder={placeholderKeep} />
              </label>
            )}
            <label className={styles.label}>Path
              <input className={styles.input} value={String(v('path'))} onChange={(e) => set('path', e.target.value)} placeholder={isEdit ? placeholderKeep : '/podcasts/my-show'} />
            </label>
            {exportMode === 'FTP' && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={Boolean(v('secure'))}
                  onChange={(e) => set('secure', e.target.checked)}
                />
                <span className="toggle__track" aria-hidden="true" />
                <span>Use TLS (FTPS)</span>
              </label>
            )}
          </>
        )}

        {exportMode === 'WebDAV' && (
          <>
            <label className={styles.label}>WebDAV URL
              <input className={styles.input} type="url" value={String(v('url'))} onChange={(e) => set('url', e.target.value)} placeholder={isEdit ? placeholderKeep : 'https://...'} required={!isEdit} />
            </label>
            <label className={styles.label}>Username
              <input className={styles.input} value={String(v('username'))} onChange={(e) => set('username', e.target.value)} placeholder={isEdit ? placeholderKeep : undefined} required={!isEdit} />
            </label>
            <label className={styles.label}>Password
              <input className={styles.input} type="password" value={String(v('password'))} onChange={(e) => set('password', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            <label className={styles.label}>Path
              <input className={styles.input} value={String(v('path'))} onChange={(e) => set('path', e.target.value)} placeholder={isEdit ? placeholderKeep : '/remote/path'} />
            </label>
          </>
        )}

        {exportMode === 'IPFS' && (
          <>
            <label className={styles.label}>IPFS API URL
              <input className={styles.input} type="url" value={String(v('api_url'))} onChange={(e) => set('api_url', e.target.value)} placeholder={isEdit ? placeholderKeep : 'http://127.0.0.1:5001'} required={!isEdit} />
            </label>
            <label className={styles.label}>API key (optional)
              <input className={styles.input} type="password" value={String(v('api_key'))} onChange={(e) => set('api_key', e.target.value)} placeholder={placeholderKeep} />
            </label>
            <label className={styles.label}>Username (for Basic auth, e.g. Caddy)
              <input className={styles.input} value={String(v('username'))} onChange={(e) => set('username', e.target.value)} placeholder={isEdit ? placeholderKeep : undefined} />
            </label>
            <label className={styles.label}>Password (for Basic auth)
              <input className={styles.input} type="password" value={String(v('password'))} onChange={(e) => set('password', e.target.value)} placeholder={placeholderKeep} />
            </label>
            <label className={styles.label}>Gateway URL (for enclosure URLs, e.g. https://ipfs.io/ipfs/)
              <input className={styles.input} type="url" value={String(v('gateway_url'))} onChange={(e) => set('gateway_url', e.target.value)} placeholder={isEdit ? placeholderKeep : 'https://ipfs.io/ipfs/'} />
            </label>
            <label className={styles.label}>Path
              <input className={styles.input} value={String(v('path'))} onChange={(e) => set('path', e.target.value)} placeholder={isEdit ? placeholderKeep : '/deploy'} />
            </label>
          </>
        )}

        {exportMode === 'SMB' && (
          <>
            <label className={styles.label}>Host
              <input className={styles.input} value={String(v('host'))} onChange={(e) => set('host', e.target.value)} placeholder={isEdit ? placeholderKeep : 'server'} required={!isEdit} />
            </label>
            <label className={styles.label}>Port (optional, default 445)
              <input className={styles.input} type="number" value={v('port') === '' || v('port') === undefined ? '' : String(v('port'))} onChange={(e) => set('port', e.target.value === '' ? '' : (parseInt(e.target.value, 10) || 0))} placeholder={isEdit ? placeholderKeep : undefined} min={1} max={65535} />
            </label>
            <label className={styles.label}>Share name
              <input className={styles.input} value={String(v('share'))} onChange={(e) => set('share', e.target.value)} placeholder={isEdit ? placeholderKeep : 'podcasts'} required={!isEdit} />
            </label>
            <label className={styles.label}>Username
              <input className={styles.input} value={String(v('username'))} onChange={(e) => set('username', e.target.value)} placeholder={isEdit ? placeholderKeep : undefined} required={!isEdit} />
            </label>
            <label className={styles.label}>Password
              <input className={styles.input} type="password" value={String(v('password'))} onChange={(e) => set('password', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            <label className={styles.label}>Domain (optional)
              <input className={styles.input} value={String(v('domain'))} onChange={(e) => set('domain', e.target.value)} placeholder={isEdit ? placeholderKeep : 'WORKGROUP'} />
            </label>
            <label className={styles.label}>Path
              <input className={styles.input} value={String(v('path'))} onChange={(e) => set('path', e.target.value)} placeholder={isEdit ? placeholderKeep : '/subfolder'} />
            </label>
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </form>
    </div>
  );
}
