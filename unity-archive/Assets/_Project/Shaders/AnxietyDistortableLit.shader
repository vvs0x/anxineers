// Simple URP forward shader with one global "space distortion" parameter.
// World-space vertices are pushed away from a fixed center, scaled per axis, so walls drift away
// and corridors lengthen without moving any transforms. Lighting is a basic Lambert + ambient term.
// Limitation: no shadow casting and no normal correction, fine for the blockout room.
Shader "Anxineers/Distortable Lit"
{
    Properties
    {
        [MainColor] _BaseColor("Color", Color) = (0.8, 0.8, 0.78, 1)
        [MainTexture] _BaseMap("Base Map", 2D) = "white" {}
        _Ambient("Ambient", Range(0, 1)) = 0.35
        [Toggle] _Distort("Receive Space Distortion", Float) = 1
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half _Ambient;
                half _Distort;
            CBUFFER_END

            // Set globally by SpaceDistortionEffect.
            float _AnxietyDistortion;
            float4 _AnxietyStretch;
            float4 _AnxietyCenter;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(IN);
                UNITY_TRANSFER_INSTANCE_ID(IN, OUT);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(OUT);

                float3 positionWS = TransformObjectToWorld(IN.positionOS.xyz);
                float3 offset = positionWS - _AnxietyCenter.xyz;
                positionWS += offset * (_AnxietyStretch.xyz * (_AnxietyDistortion * _Distort));

                OUT.positionCS = TransformWorldToHClip(positionWS);
                OUT.normalWS = TransformObjectToWorldNormal(IN.normalOS);
                OUT.uv = TRANSFORM_TEX(IN.uv, _BaseMap);
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(IN);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(IN);

                half4 albedo = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, IN.uv) * _BaseColor;
                Light mainLight = GetMainLight();
                half ndl = saturate(dot(normalize(IN.normalWS), mainLight.direction));
                half3 color = albedo.rgb * (mainLight.color * ndl + _Ambient);
                return half4(color, 1);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
