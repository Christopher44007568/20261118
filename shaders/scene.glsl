struct Hit {
    bool valid;
    vec3 position;
    vec3 normal;
    vec3 albedo;
};

const float FLOOR_Y = -1.85;

bool intersectSphere(
    vec3 rayOrigin,
    vec3 rayDirection,
    vec3 center,
    float radius,
    out float hitDistance) {
    vec3 oc = rayOrigin - center;
    float b = dot(oc, rayDirection);
    float c = dot(oc, oc) - radius * radius;
    float discriminant = b * b - c;
    if (discriminant < 0.0) {
        return false;
    }
    float root = sqrt(discriminant);
    float t = -b - root;
    if (t < 1e-4) {
        t = -b + root;
    }
    if (t < 1e-4) {
        return false;
    }
    hitDistance = t;
    return true;
}

void considerSphere(
    vec3 rayOrigin,
    vec3 rayDirection,
    vec3 center,
    float radius,
    vec3 albedo,
    inout Hit best,
    inout float bestDistance) {
    float distance;
    if (intersectSphere(rayOrigin, rayDirection, center, radius, distance) &&
        distance < bestDistance) {
        vec3 normal = normalize(rayOrigin + rayDirection * distance - center);
        best.valid = true;
        best.position = rayOrigin + rayDirection * distance;
        best.normal = normal;
        best.albedo = albedo;
        bestDistance = distance;
    }
}

Hit traceScene(vec3 rayOrigin, vec3 rayDirection) {
    Hit best;
    best.valid = false;
    best.position = vec3(0.0);
    best.normal = vec3(0.0, 1.0, 0.0);
    best.albedo = vec3(0.0);
    float bestDistance = 1e20;
    const float farPlane = frame.depthParams.y;

    considerSphere(rayOrigin, rayDirection, vec3(0.0, 0.0, 0.0), 1.85,
                   vec3(0.50, 0.63, 0.78), best, bestDistance);
    considerSphere(rayOrigin, rayDirection, vec3(-2.55, -0.55, 0.35), 0.95,
                   vec3(0.82, 0.43, 0.25), best, bestDistance);
    considerSphere(rayOrigin, rayDirection, vec3(2.55, 0.65, -0.45), 0.76,
                   vec3(0.32, 0.72, 0.48), best, bestDistance);

    if (abs(rayDirection.y) > 1e-5) {
        float t = (FLOOR_Y - rayOrigin.y) / rayDirection.y;
        if (t > 1e-4 && t < bestDistance) {
            vec3 position = rayOrigin + rayDirection * t;
            vec2 cell = floor(position.xz * 1.25);
            float checker = mod(cell.x + cell.y, 2.0);
            best.valid = true;
            best.position = position;
            best.normal = vec3(0.0, 1.0, 0.0);
            best.albedo = mix(vec3(0.16, 0.17, 0.20), vec3(0.31, 0.33, 0.37), checker);
            bestDistance = t;
        }
    }

    if (best.valid && bestDistance > farPlane) {
        best.valid = false;
    }
    return best;
}

vec3 backgroundColor(vec3 rayDirection) {
    float horizon = clamp(rayDirection.y * 0.5 + 0.5, 0.0, 1.0);
    return mix(vec3(0.008, 0.012, 0.025), vec3(0.035, 0.055, 0.095), horizon);
}

vec3 evaluatePointLight(Hit hit, Light lightData) {
    vec3 toLight = lightData.positionRadius.xyz - hit.position;
    float distanceSquared = dot(toLight, toLight);
    float radius = lightData.positionRadius.w;
    float radiusSquared = radius * radius;
    if (distanceSquared >= radiusSquared) {
        return vec3(0.0);
    }

    float inverseDistance = inversesqrt(max(distanceSquared, 1e-8));
    vec3 lightDirection = toLight * inverseDistance;
    float normalDotLight = max(dot(hit.normal, lightDirection), 0.0);
    if (normalDotLight <= 0.0) {
        return vec3(0.0);
    }

    float normalizedDistanceSquared = distanceSquared / radiusSquared;
    float window = max(1.0 - normalizedDistanceSquared, 0.0);
    window *= window;
    float attenuation = window / (distanceSquared + 0.08);

    vec3 viewDirection = normalize(frame.cameraPosition.xyz - hit.position);
    vec3 halfDirection = normalize(viewDirection + lightDirection);
    float specular = pow(max(dot(hit.normal, halfDirection), 0.0), 48.0);
    vec3 radiance = lightData.colorIntensity.rgb * lightData.colorIntensity.w;
    return radiance * attenuation *
           (hit.albedo * normalDotLight + vec3(0.18 * specular));
}

