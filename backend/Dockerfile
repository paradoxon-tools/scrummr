FROM gradle:8.14.0-jdk21 AS build
WORKDIR /build
COPY build.gradle.kts settings.gradle.kts ./
COPY src ./src
RUN gradle bootJar --no-daemon

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN mkdir -p /app/data
COPY --from=build /build/build/libs/scrummr-backend-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 8080
VOLUME ["/app/data"]
ENV SQLITE_DB_PATH=/app/data/scrummr.db
ENV FRONTEND_ORIGIN=http://localhost:5173
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
