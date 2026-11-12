FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai \
    LD_LIBRARY_PATH=/usr/local/lib

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        tzdata \
        libssl3 \
        ffmpeg && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo "$TZ" > /etc/timezone && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY libjemalloc.so.2 /usr/local/lib/libjemalloc.so.2
RUN ldconfig

WORKDIR /opt/media/bin
COPY MediaServer default.pem ./
COPY www ./www
COPY config.ini /opt/media/conf/config.ini
RUN mkdir -p /opt/media/bin/www/snap /opt/media/bin/ffmpeg && \
    chmod +x /opt/media/bin/MediaServer

# http/https, rtmp, rtsp, rtp-proxy, webrtc, srt
EXPOSE 80/tcp 443/tcp 1935/tcp 554/tcp 10000/tcp 10000/udp 8000/tcp 8000/udp 9000/udp 3702/udp

CMD ["./MediaServer", "-s", "default.pem", "-c", "/opt/media/conf/config.ini", "-l", "0"]
