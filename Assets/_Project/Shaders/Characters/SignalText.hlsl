sampler2D _TextTex;

CBUFFER_START(UnityPerMaterial)
float4 _BodyColor;
float4 _TextColor;
float4 _TextSize;
float _ScrollSpeed;
float _GlitchAmount;
float _EffectTime;
CBUFFER_END

float4 _ProjectionOrigin;

float2 SignalUV(float4 screenClip, float4 originClip, float3 originView)
{
    // Camera-facing projection anchored to this character, in approximate metres.
    float2 ndc = screenClip.xy / screenClip.w - originClip.xy / originClip.w;
    float depth = lerp(max(-originView.z, 0.001), 1.0, unity_OrthoParams.w);
    float2 projectionScale = float2(UNITY_MATRIX_P._m00, UNITY_MATRIX_P._m11);
    return ndc * depth / projectionScale / max(_TextSize.xy, 0.001) + 0.5;
}

half4 SignalColor(float2 uv)
{
    float time = _EffectTime < 0 ? _Time.y : _EffectTime;
    uv.y += time * _ScrollSpeed;
    float row = floor(uv.y * 35);
    float tick = floor(time * 9);
    float noise = frac(sin(dot(float2(row, tick), float2(12.9898, 78.233))) * 43758.5453);
    uv.x += (noise - 0.5) * _GlitchAmount * step(0.87, noise);
    float inside = step(0, uv.x) * step(uv.x, 1);
    float mask = tex2D(_TextTex, float2(saturate(uv.x), frac(uv.y))).r * inside;
    return half4(lerp(_BodyColor.rgb, _TextColor.rgb, saturate(mask)), 1);
}
