Shader "SignalCharacter/Projected Silhouette"
{
    Properties
    {
        _BodyColor ("Body Color", Color) = (0.035, 0.008, 1, 1)
        _TextColor ("Text Color", Color) = (1, 1, 1, 1)
        _TextTex ("Text Mask", 2D) = "black" {}
        _TextSize ("Projection Width / Height (metres)", Vector) = (1.25, 2, 0, 0)
        _ScrollSpeed ("Text Scroll Speed", Range(-0.2, 0.2)) = 0.012
        _GlitchAmount ("Horizontal Text Glitch", Range(0, 0.2)) = 0.015
        [HideInInspector] _ProjectionOrigin ("Character Anchor", Vector) = (0, 0.9, 0, 1)
        [HideInInspector] _EffectTime ("Preview Time (-1 = live)", Float) = -1
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Name "SignalURP"
            Tags { "LightMode"="SRPDefaultUnlit" }
            Cull Back ZWrite On ZTest LEqual
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "SignalText.hlsl"
            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings { float4 positionCS : SV_POSITION; float4 screenClip : TEXCOORD0; };
            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.screenClip = output.positionCS;
                return output;
            }
            half4 frag(Varyings input) : SV_Target
            {
                float4 originClip = TransformWorldToHClip(_ProjectionOrigin.xyz);
                float3 originView = TransformWorldToView(_ProjectionOrigin.xyz);
                return SignalColor(SignalUV(input.screenClip, originClip, originView));
            }
            ENDHLSL
        }
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        Pass
        {
            Name "SignalBuiltIn"
            Cull Back ZWrite On ZTest LEqual
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #include "UnityCG.cginc"
            #include "SignalText.hlsl"
            struct appdata { float4 vertex : POSITION; };
            struct v2f { float4 pos : SV_POSITION; float4 screenClip : TEXCOORD0; };
            v2f vert(appdata input)
            {
                v2f output;
                output.pos = UnityObjectToClipPos(input.vertex);
                output.screenClip = output.pos;
                return output;
            }
            fixed4 frag(v2f input) : SV_Target
            {
                float4 originClip = mul(UNITY_MATRIX_VP, float4(_ProjectionOrigin.xyz, 1));
                float3 originView = mul(UNITY_MATRIX_V, float4(_ProjectionOrigin.xyz, 1)).xyz;
                return SignalColor(SignalUV(input.screenClip, originClip, originView));
            }
            ENDCG
        }
    }
    Fallback Off
}
