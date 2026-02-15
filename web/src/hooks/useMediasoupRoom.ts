import { useEffect, useRef, useState } from 'react';
import * as mediasoupClient from 'mediasoup-client';

export function useMediasoupRoom(
  webrtcUrl: string | undefined,
  roomId: string | undefined,
  deviceId?: string,
) {
  const [remoteTracks, setRemoteTracks] = useState<Map<string, MediaStreamTrack>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const producerRef = useRef<mediasoupClient.types.Producer | null>(null);
  const setMutedRef = useRef<(muted: boolean) => void>((muted) => {
    const p = producerRef.current;
    if (p) {
      if (muted) p.pause();
      else p.resume();
    }
  });
  const connectSoundboardRef = useRef<(el: HTMLAudioElement | null) => void>(() => {});

  useEffect(() => {
    if (!webrtcUrl || !roomId) return;
    setReady(false);

    const url = webrtcUrl;
    const rid = roomId;
    let closed = false;
    let webrtcWs: WebSocket | null = null;
    let device: mediasoupClient.types.Device | null = null;
    let sendTransport: mediasoupClient.types.Transport | null = null;
    let recvTransport: mediasoupClient.types.Transport | null = null;
    let localStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;
    const pendingResolvers = new Map<string, Array<(value: unknown) => void>>();

    function waitFor(type: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), 15000);
        const queue = pendingResolvers.get(type) ?? [];
        queue.push((value) => {
          clearTimeout(timeout);
          const i = queue.indexOf(queue[queue.length - 1]);
          if (i !== -1) queue.splice(i, 1);
          resolve(value);
        });
        pendingResolvers.set(type, queue);
      });
    }

    async function run(wsUrl: string, roomIdParam: string) {
      try {
        const baseUrl = wsUrl.startsWith('ws') ? wsUrl : wsUrl.replace(/^http/, 'ws');
        webrtcWs = new WebSocket(`${baseUrl}?roomId=${encodeURIComponent(roomIdParam)}`);
        await new Promise<void>((resolve, reject) => {
          webrtcWs!.onopen = () => resolve();
          webrtcWs!.onerror = () => reject(new Error('WebSocket failed'));
        });
        if (closed) return;

        let handleNewProducer: (producerId: string) => void = () => {};
        webrtcWs.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as { type: string; [k: string]: unknown };
            if (msg.type === 'newProducer' && typeof msg.producerId === 'string') {
              handleNewProducer(msg.producerId);
              return;
            }
            const queue = pendingResolvers.get(msg.type);
            if (queue?.length) {
              const fn = queue.shift();
              if (fn) fn(msg);
            }
          } catch {
            // ignore
          }
        };

        webrtcWs.send(JSON.stringify({ type: 'getRouterRtpCapabilities' }));
        const capsMsg = (await waitFor('routerRtpCapabilities')) as { rtpCapabilities: mediasoupClient.types.RtpCapabilities };
        if (closed) return;
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: capsMsg.rtpCapabilities });
        if (closed) return;

        const audioConstraints: MediaTrackConstraints = deviceId
          ? { deviceId: { exact: deviceId } }
          : true;
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        const micTrack = micStream.getAudioTracks()[0];
        if (!micTrack) throw new Error('No audio track');

        const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const mixNode = ctx.createGain();
        mixNode.gain.value = 1;

        const micSource = ctx.createMediaStreamSource(micStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        analyser.minDecibels = -60;
        analyser.maxDecibels = -10;
        micSource.connect(analyser);
        analyser.connect(mixNode);

        const dest = ctx.createMediaStreamDestination();
        mixNode.connect(dest);

        const data = new Uint8Array(analyser.frequencyBinCount);
        let tickId: number | undefined;
        function tick() {
          if (closed) return;
          analyser.getByteFrequencyData(data);
          let max = 0;
          for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
          setMicLevel(Math.min(100, Math.round((max / 255) * 100)));
          tickId = requestAnimationFrame(tick);
        }
        tickId = requestAnimationFrame(tick);

        const soundboardSources: MediaElementAudioSourceNode[] = [];
        function connectSoundboard(el: HTMLAudioElement | null) {
          soundboardSources.forEach((src) => {
            try {
              src.disconnect();
            } catch {
              /* ignore */
            }
          });
          soundboardSources.length = 0;
          if (el && el.src) {
            ctx.resume().catch(() => {});
            const src = ctx.createMediaElementSource(el);
            src.connect(mixNode);
            src.connect(ctx.destination);
            soundboardSources.push(src);
          }
        }
        connectSoundboardRef.current = connectSoundboard;

        localStream = dest.stream;
        const track = localStream.getAudioTracks()[0];
        if (!track) throw new Error('No audio track');

        cleanupRef.current = () => {
          if (tickId != null) cancelAnimationFrame(tickId);
          ctx.close();
        };

        webrtcWs.send(JSON.stringify({ type: 'createWebRtcTransport' }));
        const sendTransportMsg = (await waitFor('webRtcTransportCreated')) as {
          id: string;
          iceParameters: mediasoupClient.types.IceParameters;
          iceCandidates: mediasoupClient.types.IceCandidate[];
          dtlsParameters: mediasoupClient.types.DtlsParameters;
        };
        if (closed) return;
        sendTransport = device.createSendTransport({
          id: sendTransportMsg.id,
          iceParameters: sendTransportMsg.iceParameters,
          iceCandidates: sendTransportMsg.iceCandidates,
          dtlsParameters: sendTransportMsg.dtlsParameters,
        });
        sendTransport.on('connect', async ({ dtlsParameters }, callback) => {
          webrtcWs?.send(JSON.stringify({
            type: 'connectWebRtcTransport',
            transportId: sendTransportMsg.id,
            dtlsParameters,
          }));
          await waitFor('webRtcTransportConnected');
          callback();
        });
        sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
          try {
            webrtcWs?.send(JSON.stringify({
              type: 'produce',
              transportId: sendTransportMsg.id,
              kind,
              rtpParameters,
            }));
            const producedMsg = (await waitFor('produced')) as { id: string };
            if (closed) return;
            callback({ id: producedMsg.id });
          } catch (e) {
            errback(e as Error);
          }
        });
        const producer = await sendTransport.produce({ track });
        if (closed) return;
        producerRef.current = producer;
        setReady(true);
        const myProducerId = producer.id;

        webrtcWs.send(JSON.stringify({ type: 'createWebRtcTransport' }));
        const recvTransportMsg = (await waitFor('webRtcTransportCreated')) as {
          id: string;
          iceParameters: mediasoupClient.types.IceParameters;
          iceCandidates: mediasoupClient.types.IceCandidate[];
          dtlsParameters: mediasoupClient.types.DtlsParameters;
        };
        if (closed) return;
        recvTransport = device.createRecvTransport({
          id: recvTransportMsg.id,
          iceParameters: recvTransportMsg.iceParameters,
          iceCandidates: recvTransportMsg.iceCandidates,
          dtlsParameters: recvTransportMsg.dtlsParameters,
        });
        recvTransport.on('connect', async ({ dtlsParameters }, callback) => {
          webrtcWs?.send(JSON.stringify({
            type: 'connectWebRtcTransport',
            transportId: recvTransportMsg.id,
            dtlsParameters,
          }));
          await waitFor('webRtcTransportConnected');
          callback();
        });

        async function consumeProducer(pid: string) {
          webrtcWs?.send(JSON.stringify({
            type: 'consume',
            transportId: recvTransportMsg.id,
            producerId: pid,
            rtpCapabilities: device!.rtpCapabilities,
          }));
          const consumedMsg = (await waitFor('consumed')) as {
            id: string;
            producerId: string;
            kind: string;
            rtpParameters: mediasoupClient.types.RtpParameters;
          };
          const consumer = await recvTransport!.consume({
            id: consumedMsg.id,
            producerId: consumedMsg.producerId,
            kind: consumedMsg.kind as mediasoupClient.types.MediaKind,
            rtpParameters: consumedMsg.rtpParameters,
          });
          return consumer;
        }

        webrtcWs.send(JSON.stringify({ type: 'getProducers' }));
        const producersMsg = (await waitFor('producers')) as { producerIds: string[] };
        if (closed) return;
        const consumedProducerIds = new Set<string>();
        for (const producerId of producersMsg.producerIds || []) {
          if (producerId === myProducerId) continue;
          try {
            const consumer = await consumeProducer(producerId);
            if (closed) return;
            consumedProducerIds.add(producerId);
            setRemoteTracks((prev) => new Map(prev).set(consumer.id, consumer.track));
          } catch {
            // skip
          }
        }

        handleNewProducer = async (producerId: string) => {
          if (producerId === myProducerId || consumedProducerIds.has(producerId) || closed) return;
          try {
            const consumer = await consumeProducer(producerId);
            if (closed) return;
            consumedProducerIds.add(producerId);
            setRemoteTracks((prev) => new Map(prev).set(consumer.id, consumer.track));
          } catch {
            // skip
          }
        };

      } catch (err) {
        if (!closed) setError(err instanceof Error ? err.message : 'Media failed');
      }
    }

    run(url, rid);
    return () => {
      closed = true;
      cleanupRef.current?.();
      pendingResolvers.forEach((queue) => queue.forEach((r) => r(null)));
      webrtcWs?.close();
      localStream?.getTracks().forEach((t) => t.stop());
      micStream?.getTracks().forEach((t) => t.stop());
      sendTransport?.close();
      recvTransport?.close();
    };
  }, [webrtcUrl, roomId, deviceId]);

  return {
    remoteTracks,
    error,
    ready,
    micLevel,
    setMuted: (muted: boolean) => setMutedRef.current(muted),
    connectSoundboard: (el: HTMLAudioElement | null) => connectSoundboardRef.current(el),
  };
}
