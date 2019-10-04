FROM maxmcd/deno

COPY . .

RUN deno fetch server.ts

EXPOSE 8080
ENV LISTEN=0.0.0.0:8080

CMD ["deno", "--allow-env", "--allow-net=0.0.0.0:8080,api.telegram.org", "server.ts"]
